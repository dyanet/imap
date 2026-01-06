import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';

export interface GmailViewerCdkStackProps extends cdk.StackProps {
  readonly vpcId?: string;
  readonly privateSubnets?: string[];
  readonly publicSubnets?: string[];
  readonly containerPort?: number | string;
  readonly containerCpu?: number | string;
  readonly containerMemory?: number | string;
  readonly desiredCount?: number | string;
  readonly certificateArn?: string;
  readonly apiCustomDomainName?: string;
  readonly hostedZoneId?: string;
  readonly serviceDiscoveryNamespaceName?: string;
  readonly serviceDiscoveryTtl?: number | string;
  readonly ssmPrefix?: string;
  readonly gitHubOwner?: string;
  readonly gitHubRepo?: string;
  readonly gitHubBranch?: string;
  readonly publicEnvValue?: string;
  readonly googleClientId?: string;
  readonly googleClientSecret?: string;
  readonly sessionSecretValue?: string;
  readonly useGitHubWebhooks?: boolean;
  readonly codeConnectionArn?: string;
}

export class GmailViewerCdkStack extends cdk.Stack {
  public readonly clusterName: string;
  public readonly repositoryUri: string;
  public readonly apiInvokeUrl: string;
  public readonly cloudMapServiceArn: string;

  public constructor(scope: cdk.App, id: string, props: GmailViewerCdkStackProps) {
    super(scope, id, props);

    const toNumber = (value: string | number | undefined, fallback: number): number => {
      const candidate = value ?? fallback;
      const parsed = typeof candidate === 'number' ? candidate : Number(candidate);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const toCpuUnits = (value: string | number | undefined): number => {
      const parsed = toNumber(value, 0.5);
      const vcpu = parsed <= 4 ? parsed * 1024 : parsed;
      return Math.max(256, Math.round(vcpu / 256) * 256);
    };

    const repoParts = (process.env.GITHUB_REPOSITORY ?? '').split('/');
    const containerPort = toNumber(props.containerPort, 3000);
    const containerCpu = toCpuUnits(props.containerCpu);
    const containerMemory = toNumber(props.containerMemory, 1024);
    const desiredCount = toNumber(props.desiredCount, 1);
    const nsName = props.serviceDiscoveryNamespaceName ?? 'mail.local';
    const nsTtl = cdk.Duration.seconds(toNumber(props.serviceDiscoveryTtl, 60));
    const ssmPrefixRaw = props.ssmPrefix ?? '/mail-example';
    const ssmPrefix = '/' + ssmPrefixRaw.split('/').filter(p => p).join('/');
    const gitHubOwner = props.gitHubOwner ?? (repoParts[0] || 'dyanet');
    const gitHubRepo = props.gitHubRepo ?? (repoParts[1] || 'imap');
    const gitHubBranch = props.gitHubBranch ?? process.env.GITHUB_REF_NAME ?? 'main';
    const publicEnvValue = props.publicEnvValue ?? 'production';
    const googleClientId = props.googleClientId || 'PLACEHOLDER_GOOGLE_CLIENT_ID';
    const googleClientSecret = props.googleClientSecret || 'PLACEHOLDER_GOOGLE_CLIENT_SECRET';
    const sessionSecretValue = props.sessionSecretValue || 'PLACEHOLDER_SESSION_SECRET';
    const apiDomain = props.apiCustomDomainName ?? process.env.API_CUSTOM_DOMAIN ?? 'demo.dyanet.com';
    const certArn = props.certificateArn ?? this.node.tryGetContext('certificateArn') ?? process.env.CERTIFICATE_ARN;
    const zoneId = props.hostedZoneId ?? '';
    const hasCustomDomain = Boolean(certArn && apiDomain);
    const hasHostedZone = Boolean(zoneId);
    const usePublicSubnets = props.publicSubnets && props.publicSubnets.length > 0;

    // VPC setup
    let vpc: ec2.IVpc;
    let serviceSubnetIds: string[];
    const useVpcParameter = this.node.tryGetContext('useVpcParameter');

    if (!useVpcParameter && this.account && this.region) {
      vpc = ec2.Vpc.fromLookup(this, 'MailVpc', { tags: { Name: 'dya-vpc' } });
      if (usePublicSubnets) {
        serviceSubnetIds = props.publicSubnets!;
      } else if (props.privateSubnets && props.privateSubnets.length > 0) {
        serviceSubnetIds = props.privateSubnets;
      } else {
        const badAz = 'cac1-az4';
        let subnets = vpc.privateSubnets.filter(s => s.availabilityZone !== badAz);
        if (subnets.length === 0) subnets = vpc.publicSubnets.filter(s => s.availabilityZone !== badAz);
        serviceSubnetIds = subnets.slice(0, 2).map(s => s.subnetId);
        if (serviceSubnetIds.length < 1) throw new Error(`VPC must have at least one subnet in an allowed AZ.`);
      }
    } else {
      const vpcIdParam = new cdk.CfnParameter(this, 'VpcIdParam', { type: 'AWS::EC2::VPC::Id', default: props.vpcId ?? '' });
      const subnetParam = new cdk.CfnParameter(this, 'PrivateSubnetIdsParam', { type: 'CommaDelimitedList', default: props.privateSubnets?.join(',') ?? '' });
      vpc = ec2.Vpc.fromVpcAttributes(this, 'MailVpc', { vpcId: vpcIdParam.valueAsString, availabilityZones: cdk.Fn.getAzs(), privateSubnetIds: subnetParam.valueAsList });
      serviceSubnetIds = props.privateSubnets ?? subnetParam.valueAsList;
    }

    // Security Groups (L2)
    const apiVpcLinkSg = new ec2.SecurityGroup(this, 'ApiVpcLinkSecurityGroup', { vpc, description: 'Egress from API Gateway VPC Link', allowAllOutbound: false });
    apiVpcLinkSg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(containerPort));

    const serviceSg = new ec2.SecurityGroup(this, 'ServiceSecurityGroup', { vpc, description: 'Allow traffic to Fargate tasks', allowAllOutbound: true });
    serviceSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(containerPort));

    // Log Group (L2)
    const appLogGroup = new logs.LogGroup(this, 'AppLogGroup', { logGroupName: '/ecs/mail-example', retention: logs.RetentionDays.ONE_MONTH, removalPolicy: cdk.RemovalPolicy.DESTROY });

    // ECS Cluster (L2)
    const cluster = new ecs.Cluster(this, 'MailCluster', { vpc, clusterName: 'public-cluster', enableFargateCapacityProviders: true });


    // ECR Repository - create if not exists using custom resource
    const ecrRepoName = 'mail-example';
    const checkEcrRepo = new cr.AwsCustomResource(this, 'CheckEcrRepo', {
      onCreate: { service: 'ECR', action: 'describeRepositories', parameters: { repositoryNames: [ecrRepoName] }, physicalResourceId: cr.PhysicalResourceId.of(ecrRepoName) },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE }),
    });
    const createEcrRepo = new cr.AwsCustomResource(this, 'CreateEcrRepo', {
      onCreate: { service: 'ECR', action: 'createRepository', parameters: { repositoryName: ecrRepoName, imageTagMutability: 'MUTABLE', encryptionConfiguration: { encryptionType: 'AES256' } }, physicalResourceId: cr.PhysicalResourceId.of(ecrRepoName), ignoreErrorCodesMatching: 'RepositoryAlreadyExistsException' },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE }),
    });
    createEcrRepo.node.addDependency(checkEcrRepo);
    const ecrRepo = ecr.Repository.fromRepositoryName(this, 'MailExampleRepositoryRef', ecrRepoName);

    // API Gateway HTTP API (L1 - no L2 for HTTP API with VPC Link)
    const httpApi = new apigatewayv2.CfnApi(this, 'MailHttpApi', { name: 'mail-example', protocolType: 'HTTP' });
    const apiStage = new apigatewayv2.CfnStage(this, 'MailApiStage', { stageName: 'prod', apiId: httpApi.ref, autoDeploy: true });

    const apiDomainName = hasCustomDomain ? new apigatewayv2.CfnDomainName(this, 'ApiDomainName', {
      domainName: apiDomain, domainNameConfigurations: [{ certificateArn: certArn!, endpointType: 'REGIONAL', securityPolicy: 'TLS_1_2' }],
    }) : undefined;

    const apiMapping = hasCustomDomain && apiDomainName ? new apigatewayv2.CfnApiMapping(this, 'ApiMapping', {
      apiId: httpApi.ref, domainName: apiDomainName.ref, stage: apiStage.ref, apiMappingKey: 'examples',
    }) : undefined;
    if (apiMapping && apiDomainName) { apiMapping.addDependency(apiDomainName); apiMapping.addDependency(apiStage); }

    const apiRecord = hasCustomDomain && hasHostedZone && apiDomainName ? new route53.CfnRecordSet(this, 'ApiDomainRecord', {
      hostedZoneId: zoneId, name: apiDomain, type: 'A', aliasTarget: { dnsName: apiDomainName.attrRegionalDomainName, hostedZoneId: apiDomainName.attrRegionalHostedZoneId },
    }) : undefined;
    if (apiRecord && apiDomainName) apiRecord.addDependency(apiDomainName);

    const baseUrl = hasCustomDomain ? `https://${apiDomain}/examples/gmail-viewer` : cdk.Fn.join('', [httpApi.attrApiEndpoint, '/', apiStage.ref, '/gmail-viewer']);

    // Cloud Map Namespace (L2)
    const namespace = new servicediscovery.PrivateDnsNamespace(this, 'ServiceNamespace', { name: nsName, vpc, description: 'Namespace for mail services' });

    // VPC Link (L1)
    const vpcLink = new apigatewayv2.CfnVpcLink(this, 'ApiVpcLink', { name: 'mail-example-vpclink', subnetIds: serviceSubnetIds, securityGroupIds: [apiVpcLinkSg.securityGroupId] });

    // Cloud Map Service (L2)
    const cloudMapService = new servicediscovery.Service(this, 'AppCloudMapService', {
      name: 'mail-example', namespace, dnsRecordType: servicediscovery.DnsRecordType.SRV, dnsTtl: nsTtl, routingPolicy: servicediscovery.RoutingPolicy.WEIGHTED, customHealthCheck: { failureThreshold: 1 },
    });

    // Secrets Manager - all config values for the application
    const appSecrets = new secretsmanager.Secret(this, 'AppSecrets', {
      secretName: `${ssmPrefix}/config`,
      description: 'Application configuration for mail-example',
      secretObjectValue: {
        GOOGLE_CLIENT_ID: cdk.SecretValue.unsafePlainText(googleClientId),
        GOOGLE_CLIENT_SECRET: cdk.SecretValue.unsafePlainText(googleClientSecret),
        SESSION_SECRET: cdk.SecretValue.unsafePlainText(sessionSecretValue),
        BASE_URL: cdk.SecretValue.unsafePlainText(baseUrl.toString()),
        PORT: cdk.SecretValue.unsafePlainText(containerPort.toString()),
      },
    });

    // IAM Roles (L2)
    const taskExecRole = new iam.Role(this, 'TaskExecutionRole', { assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'), managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')] });
    taskExecRole.addToPolicy(new iam.PolicyStatement({ actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath', 'kms:Decrypt'], resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${ssmPrefix}*`, `arn:aws:kms:${this.region}:${this.account}:key/*`] }));
    taskExecRole.addToPolicy(new iam.PolicyStatement({ actions: ['secretsmanager:GetSecretValue'], resources: [appSecrets.secretArn] }));

    const taskRole = new iam.Role(this, 'TaskRole', { assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com') });
    taskRole.addToPolicy(new iam.PolicyStatement({ actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath', 'kms:Decrypt'], resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${ssmPrefix}*`, `arn:aws:kms:${this.region}:${this.account}:key/*`] }));
    taskRole.addToPolicy(new iam.PolicyStatement({ actions: ['secretsmanager:GetSecretValue'], resources: [appSecrets.secretArn] }));

    // ECS Task Definition (L2)
    const taskDef = new ecs.FargateTaskDefinition(this, 'AppTaskDefinition', { family: 'mail-example', cpu: containerCpu, memoryLimitMiB: containerMemory, executionRole: taskExecRole, taskRole });
    taskDef.addContainer('mail-example', {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepo, 'latest'), portMappings: [{ containerPort }],
      logging: ecs.LogDrivers.awsLogs({ logGroup: appLogGroup, streamPrefix: 'mail-example' }),
      environment: { CONFIG_SSM_PREFIX: ssmPrefix, PORT: containerPort.toString(), BASE_URL: baseUrl.toString(), NODE_ENV: publicEnvValue },
      secrets: {
        GOOGLE_CLIENT_ID: ecs.Secret.fromSecretsManager(appSecrets, 'GOOGLE_CLIENT_ID'),
        GOOGLE_CLIENT_SECRET: ecs.Secret.fromSecretsManager(appSecrets, 'GOOGLE_CLIENT_SECRET'),
        SESSION_SECRET: ecs.Secret.fromSecretsManager(appSecrets, 'SESSION_SECRET'),
      },
    });

    // ECS Service (L2) - associate with standalone Cloud Map service for API Gateway integration
    const service = new ecs.FargateService(this, 'AppService', {
      serviceName: 'mail-example', cluster, taskDefinition: taskDef, desiredCount,
      capacityProviderStrategies: [{ capacityProvider: 'FARGATE_SPOT', weight: 4 }, { capacityProvider: 'FARGATE', weight: 1 }],
      vpcSubnets: { subnets: serviceSubnetIds.map((id, i) => ec2.Subnet.fromSubnetId(this, `ServiceSubnet${i}`, id)) },
      securityGroups: [serviceSg], assignPublicIp: usePublicSubnets ?? false, minHealthyPercent: 50, maxHealthyPercent: 200,
    });
    service.associateCloudMapService({ service: cloudMapService, containerPort, container: taskDef.defaultContainer! });

    // API Gateway Integration (L1)
    const integration = new apigatewayv2.CfnIntegration(this, 'MailIntegration', { apiId: httpApi.ref, integrationType: 'HTTP_PROXY', integrationMethod: 'ANY', integrationUri: cloudMapService.serviceArn, connectionType: 'VPC_LINK', connectionId: vpcLink.ref, payloadFormatVersion: '1.0' });
    new apigatewayv2.CfnRoute(this, 'GmailViewerRoute', { apiId: httpApi.ref, routeKey: 'ANY /gmail-viewer', target: `integrations/${integration.ref}` });
    new apigatewayv2.CfnRoute(this, 'GmailViewerProxyRoute', { apiId: httpApi.ref, routeKey: 'ANY /gmail-viewer/{proxy+}', target: `integrations/${integration.ref}` });

    // CodeBuild Role (L2)
    const buildRole = new iam.Role(this, 'CodeBuildRole', { assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com') });
    buildRole.addToPolicy(new iam.PolicyStatement({ actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'], resources: ['*'] }));
    buildRole.addToPolicy(new iam.PolicyStatement({ actions: ['ecr:GetAuthorizationToken', 'ecr:BatchCheckLayerAvailability', 'ecr:CompleteLayerUpload', 'ecr:BatchGetImage', 'ecr:DescribeRepositories', 'ecr:InitiateLayerUpload', 'ecr:PutImage', 'ecr:UploadLayerPart'], resources: ['*'] }));
    buildRole.addToPolicy(new iam.PolicyStatement({ actions: ['ecs:UpdateService', 'ecs:DescribeServices', 'ecs:DescribeClusters'], resources: ['*'] }));
    buildRole.addToPolicy(new iam.PolicyStatement({ actions: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'], resources: ['*'] }));
    if (props.codeConnectionArn) buildRole.addToPolicy(new iam.PolicyStatement({ actions: ['codeconnections:GetConnection', 'codeconnections:GetConnectionToken', 'codeconnections:UseConnection'], resources: [props.codeConnectionArn] }));

    // CodeBuild Project (L2)
    new codebuild.Project(this, 'CodeBuildProject', {
      projectName: 'mail-example', role: buildRole,
      environment: { buildImage: codebuild.LinuxBuildImage.STANDARD_7_0, computeType: codebuild.ComputeType.SMALL, privileged: true, environmentVariables: { ECR_URI: { value: ecrRepo.repositoryUri }, CLUSTER_NAME: { value: cluster.clusterName }, SERVICE_NAME: { value: 'mail-example' } } },
      source: codebuild.Source.gitHub({ owner: gitHubOwner, repo: gitHubRepo, branchOrRef: gitHubBranch }),
      timeout: cdk.Duration.minutes(30), queuedTimeout: cdk.Duration.minutes(30), badge: true, description: 'Build & deploy mail-example to ECR then force ECS deploy',
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: { commands: ['echo "Logging in to ECR"', 'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $ECR_URI', 'IMAGE_TAG=${CODEBUILD_RESOLVED_SOURCE_VERSION:-latest}'] },
          build: { commands: ['cd examples/gmail-viewer', 'docker build -t $ECR_URI:latest -t $ECR_URI:$IMAGE_TAG .'] },
          post_build: { commands: ['docker push $ECR_URI:latest', 'docker push $ECR_URI:$IMAGE_TAG', 'aws ecs update-service --cluster $CLUSTER_NAME --service $SERVICE_NAME --force-new-deployment'] },
        },
        artifacts: { files: [] }, env: { shell: 'bash' },
      }),
    });

    // Outputs
    this.clusterName = cluster.clusterName;
    new cdk.CfnOutput(this, 'ClusterName', { value: this.clusterName });
    this.repositoryUri = ecrRepo.repositoryUri;
    new cdk.CfnOutput(this, 'RepositoryUri', { value: this.repositoryUri });
    this.apiInvokeUrl = baseUrl.toString();
    new cdk.CfnOutput(this, 'ApiInvokeUrl', { value: this.apiInvokeUrl });
    this.cloudMapServiceArn = cloudMapService.serviceArn;
    new cdk.CfnOutput(this, 'CloudMapServiceArn', { value: this.cloudMapServiceArn });
  }
}
