import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';
import * as ssm from 'aws-cdk-lib/aws-ssm';

export interface GmailViewerCdkStackProps extends cdk.StackProps {
  readonly vpcId?: string;
  readonly privateSubnets?: string[];
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
      const rounded = Math.round(vcpu / 256) * 256;
      return Math.max(256, rounded);
    };

    const repoParts = (process.env.GITHUB_REPOSITORY ?? '').split('/');
    const guessedGitHubOwner = repoParts[0] || 'dyanet';
    const guessedGitHubRepo = repoParts[1] || 'imap';

    const containerPort = toNumber(props.containerPort, 3000);
    const containerCpu = toCpuUnits(props.containerCpu);
    const containerMemory = toNumber(props.containerMemory, 1024);
    const desiredCount = toNumber(props.desiredCount, 1);
    const serviceDiscoveryNamespaceName = props.serviceDiscoveryNamespaceName ?? 'mail.local';
    const serviceDiscoveryTtl = toNumber(props.serviceDiscoveryTtl, 60);
    const ssmPrefixRaw = props.ssmPrefix ?? '/mail-example';
    const ssmPrefix = '/' + ssmPrefixRaw.split('/').filter(p => p).join('/');
    const gitHubOwner = props.gitHubOwner ?? guessedGitHubOwner;
    const gitHubRepo = props.gitHubRepo ?? guessedGitHubRepo;
    const gitHubBranch = props.gitHubBranch ?? process.env.GITHUB_REF_NAME ?? 'main';
    const publicEnvValue = props.publicEnvValue ?? 'production';
    const googleClientId = props.googleClientId || 'not-set';
    const googleClientSecret = props.googleClientSecret ?? 'not-set';
    const sessionSecretValue = props.sessionSecretValue ?? 'not-set';
    const apiCustomDomainName = props.apiCustomDomainName ?? process.env.API_CUSTOM_DOMAIN ?? 'mail.dyanet.com';
    const certificateArn = props.certificateArn ?? this.node.tryGetContext('certificateArn') ?? process.env.CERTIFICATE_ARN;
    const hostedZoneId = props.hostedZoneId ?? '';
    const hasCustomDomain = Boolean(certificateArn && apiCustomDomainName);
    const hasHostedZone = Boolean(hostedZoneId);

    let vpc: ec2.IVpc;
    let privateSubnetIds: string[];
    let serviceSubnetIds: string[];

    // If account/region are available, use Vpc.fromLookup to automatically discover subnets.
    // Otherwise fall back to CloudFormation parameters which let the deployer pick values in the console.
    const useVpcParameter = this.node.tryGetContext('useVpcParameter');

    if (!useVpcParameter && this.account && this.region) {
      vpc = ec2.Vpc.fromLookup(this, 'MailVpc', { tags: { Name: 'dya-vpc' } });
      
      if (props.privateSubnets && props.privateSubnets.length > 0) {
          privateSubnetIds = props.privateSubnets;
      } else {
          // The service linked to the VPC Link may not be available in all Availability Zones.
          const badAz = 'cac1-az4';
          
          let subnets = vpc.privateSubnets.filter(s => s.availabilityZone !== badAz);
          if (subnets.length === 0) {
            // No private subnets, try public subnets
            subnets = vpc.publicSubnets.filter(s => s.availabilityZone !== badAz);
          }

          privateSubnetIds = subnets.slice(0, 2).map(s => s.subnetId);
          
          if (privateSubnetIds.length < 1) {
            throw new Error(`VPC '${vpc.vpcId}' must have at least one private or public subnet in an allowed availability zone (not in ${badAz}).`);
          }
      }
      serviceSubnetIds = privateSubnetIds;
    } else {
      // CloudFormation parameter for VPC selection (dropdown of VPC IDs in the console)
      const vpcIdParam = new cdk.CfnParameter(this, 'VpcIdParam', {
        type: 'AWS::EC2::VPC::Id',
        default: props.vpcId ?? '',
      });

      // Optional parameter for private subnet IDs (CommaDelimitedList) when synthesizing without account/region
      const privateSubnetIdsParam = new cdk.CfnParameter(this, 'PrivateSubnetIdsParam', {
        type: 'CommaDelimitedList',
        default: props.privateSubnets && props.privateSubnets.length > 0 ? props.privateSubnets.join(',') : '',
      });
      // Use the provided parameter values (deployer must supply private subnet ids when synthesizing without lookup)
      vpc = ec2.Vpc.fromVpcAttributes(this, 'MailVpc', {
        vpcId: vpcIdParam.valueAsString,
        availabilityZones: cdk.Fn.getAzs(),
        privateSubnetIds: privateSubnetIdsParam.valueAsList,
      });
      privateSubnetIds = props.privateSubnets ?? privateSubnetIdsParam.valueAsList;
      serviceSubnetIds = privateSubnetIds;
    }

    const apiVpcLinkSecurityGroup = new ec2.CfnSecurityGroup(this, 'ApiVpcLinkSecurityGroup', {
      groupDescription: 'Egress from API Gateway VPC Link to service',
      vpcId: vpc.vpcId,
      securityGroupEgress: [
        {
          ipProtocol: 'tcp',
          fromPort: containerPort,
          toPort: containerPort,
          cidrIp: '0.0.0.0/0',
        },
      ],
    });
    apiVpcLinkSecurityGroup.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const serviceSecurityGroup = new ec2.CfnSecurityGroup(this, 'ServiceSecurityGroup', {
      groupDescription: 'Allow API Gateway VPC Link to reach Fargate tasks',
      vpcId: vpc.vpcId,
      securityGroupIngress: [
        {
          ipProtocol: 'tcp',
          fromPort: containerPort,
          toPort: containerPort,
          cidrIp: '0.0.0.0/0',
        },
      ],
      securityGroupEgress: [
        {
          ipProtocol: '-1',
          fromPort: 0,
          toPort: 65535,
          cidrIp: '0.0.0.0/0',
        },
      ],
    });
    serviceSecurityGroup.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const appLogGroup = new logs.CfnLogGroup(this, 'AppLogGroup', {
      logGroupName: '/ecs/mail-example',
      retentionInDays: 30,
    });
    appLogGroup.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const mailCluster = new ecs.CfnCluster(this, 'MailCluster', {
      clusterName: 'mail-cluster',
      capacityProviders: ['FARGATE', 'FARGATE_SPOT'],
      defaultCapacityProviderStrategy: [
        {
          capacityProvider: 'FARGATE_SPOT',
          weight: 4,
        },
        {
          capacityProvider: 'FARGATE',
          weight: 1,
        },
      ],
    });
    mailCluster.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const mailExampleRepository = new ecr.CfnRepository(this, 'MailExampleRepository', {
      repositoryName: 'mail-example',
      imageTagMutability: 'MUTABLE',
      encryptionConfiguration: {
        encryptionType: 'AES256',
      },
      lifecyclePolicy: {
        lifecyclePolicyText:
          '{\n  "rules": [\n    {\n      "rulePriority": 1,\n      "description": "Expire images older than 30 days",\n      "selection": {\n        "tagStatus": "any",\n        "countType": "sinceImagePushed",\n        "countUnit": "days",\n        "countNumber": 30\n      },\n      "action": { "type": "expire" }\n    }\n  ]\n}\n',
      },
    });
    mailExampleRepository.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const mailHttpApi = new apigatewayv2.CfnApi(this, 'MailHttpApi', {
      name: 'mail-example',
      protocolType: 'HTTP',
    });
    mailHttpApi.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const mailApiStage = new apigatewayv2.CfnStage(this, 'MailApiStage', {
      stageName: 'prod',
      apiId: mailHttpApi.ref,
      autoDeploy: true,
    });
    mailApiStage.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const apiDomainName = hasCustomDomain
      ? new apigatewayv2.CfnDomainName(this, 'ApiDomainName', {
          domainName: apiCustomDomainName,
          domainNameConfigurations: [
            {
              certificateArn: certificateArn!,
              endpointType: 'REGIONAL',
              securityPolicy: 'TLS_1_2',
            },
          ],
        })
      : undefined;
    if (apiDomainName) {
      apiDomainName.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;
    }

    const apiMapping =
      hasCustomDomain && apiDomainName
        ? new apigatewayv2.CfnApiMapping(this, 'ApiMapping', {
            apiId: mailHttpApi.ref,
            domainName: apiDomainName.ref,
            stage: mailApiStage.ref,
            apiMappingKey: 'examples',
          })
        : undefined;
    if (apiMapping) {
      apiMapping.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;
    }

    const apiDomainRecord =
      hasCustomDomain && hasHostedZone && apiDomainName
        ? new route53.CfnRecordSet(this, 'ApiDomainRecord', {
            hostedZoneId,
            name: apiCustomDomainName,
            type: 'A',
            aliasTarget: {
              dnsName: apiDomainName.attrRegionalDomainName,
              hostedZoneId: apiDomainName.attrRegionalHostedZoneId,
            },
          })
        : undefined;
    if (apiDomainRecord) {
      apiDomainRecord.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;
    }
    if (apiMapping && apiDomainName) {
      apiMapping.addDependency(apiDomainName);
      apiMapping.addDependency(mailApiStage);
    }
    if (apiDomainRecord && apiDomainName) {
      apiDomainRecord.addDependency(apiDomainName);
    }

    const baseUrl = hasCustomDomain
      ? `https://${apiCustomDomainName}/examples/gmail-viewer`
      : cdk.Fn.join('', [mailHttpApi.attrApiEndpoint, '/', mailApiStage.ref, '/gmail-viewer']);

    const serviceNamespace = new servicediscovery.CfnPrivateDnsNamespace(this, 'ServiceNamespace', {
      name: serviceDiscoveryNamespaceName,
      vpc: vpc.vpcId,
      description: 'Namespace for mail services',
    });
    serviceNamespace.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const apiVpcLink = new apigatewayv2.CfnVpcLink(this, 'ApiVpcLink', {
      name: 'mail-example-vpclink',
      subnetIds: serviceSubnetIds,
      securityGroupIds: [apiVpcLinkSecurityGroup.ref],
    });
    apiVpcLink.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const appCloudMapService = new servicediscovery.CfnService(this, 'AppCloudMapService', {
      name: 'mail-example',
      namespaceId: serviceNamespace.ref,
      dnsConfig: {
        routingPolicy: 'WEIGHTED',
        dnsRecords: [
          {
            ttl: serviceDiscoveryTtl,
            type: 'SRV',
          },
        ],
      },
      healthCheckCustomConfig: {
        failureThreshold: 1,
      },
    });
    appCloudMapService.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const taskExecutionRole = new iam.CfnRole(this, 'TaskExecutionRole', {
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'ecs-tasks.amazonaws.com',
            },
            Action: 'sts:AssumeRole',
          },
        ],
      },
      managedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy'],
      policies: [
        {
          policyName: 'AllowParameterReadForSecrets',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath', 'kms:Decrypt'],
                Resource: [
                  `arn:aws:ssm:${this.region}:${this.account}:parameter${ssmPrefix}*`,
                  `arn:aws:kms:${this.region}:${this.account}:key/*`,
                ],
              },
            ],
          },
        },
      ],
    });
    taskExecutionRole.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const taskRole = new iam.CfnRole(this, 'TaskRole', {
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'ecs-tasks.amazonaws.com',
            },
            Action: 'sts:AssumeRole',
          },
        ],
      },
      policies: [
        {
          policyName: 'AppRuntimeConfigRead',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath', 'kms:Decrypt'],
                Resource: [
                  `arn:aws:ssm:${this.region}:${this.account}:parameter${ssmPrefix}*`,
                  `arn:aws:kms:${this.region}:${this.account}:key/*`,
                ],
              },
            ],
          },
        },
      ],
    });
    taskRole.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const appTaskDefinition = new ecs.CfnTaskDefinition(this, 'AppTaskDefinition', {
      family: 'mail-example',
      cpu: containerCpu.toString(),
      memory: containerMemory.toString(),
      networkMode: 'awsvpc',
      requiresCompatibilities: ['FARGATE'],
      executionRoleArn: taskExecutionRole.attrArn,
      taskRoleArn: taskRole.attrArn,
      containerDefinitions: [
        {
          name: 'mail-example',
          image: `${mailExampleRepository.attrRepositoryUri}:latest`,
          portMappings: [
            {
              containerPort,
            },
          ],
          logConfiguration: {
            logDriver: 'awslogs',
            options: {
              'awslogs-group': appLogGroup.ref,
              'awslogs-region': this.region,
              'awslogs-stream-prefix': 'mail-example',
            },
          },
          environment: [
            {
              name: 'CONFIG_SSM_PREFIX',
              value: ssmPrefix,
            },
            {
              name: 'PORT',
              value: containerPort.toString(),
            },
            {
              name: 'BASE_URL',
              value: baseUrl.toString(),
            },
            {
              name: 'NODE_ENV',
              value: publicEnvValue,
            },
          ],
          secrets: [
            {
              name: 'GOOGLE_CLIENT_ID',
              valueFrom: `arn:aws:ssm:${this.region}:${this.account}:parameter${ssmPrefix}/env/GOOGLE_CLIENT_ID`,
            },
            {
              name: 'GOOGLE_CLIENT_SECRET',
              valueFrom: `arn:aws:ssm:${this.region}:${this.account}:parameter${ssmPrefix}/secrets/GOOGLE_CLIENT_SECRET`,
            },
            {
              name: 'SESSION_SECRET',
              valueFrom: `arn:aws:ssm:${this.region}:${this.account}:parameter${ssmPrefix}/secrets/SESSION_SECRET`,
            },
          ],
        },
      ],
    });
    appTaskDefinition.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    new ecs.CfnService(this, 'AppService', {
      serviceName: 'mail-example',
      cluster: mailCluster.ref,
      taskDefinition: appTaskDefinition.ref,
      desiredCount,
      capacityProviderStrategy: [
        {
          capacityProvider: 'FARGATE_SPOT',
          weight: 4,
        },
        {
          capacityProvider: 'FARGATE',
          weight: 1,
        },
      ],
      deploymentConfiguration: {
        maximumPercent: 200,
        minimumHealthyPercent: 50,
      },
      networkConfiguration: {
        awsvpcConfiguration: {
          assignPublicIp: 'DISABLED',
          subnets: serviceSubnetIds,
          securityGroups: [serviceSecurityGroup.ref],
        },
      },
      serviceRegistries: [
        {
          registryArn: appCloudMapService.attrArn,
          containerName: 'mail-example',
          containerPort: containerPort,
        },
      ],
      platformVersion: 'LATEST',
    });

    const mailIntegration = new apigatewayv2.CfnIntegration(this, 'MailIntegration', {
      apiId: mailHttpApi.ref,
      integrationType: 'HTTP_PROXY',
      integrationMethod: 'ANY',
      integrationUri: appCloudMapService.attrArn,
      connectionType: 'VPC_LINK',
      connectionId: apiVpcLink.ref,
      payloadFormatVersion: '1.0',
    });

    new apigatewayv2.CfnRoute(this, 'GmailViewerRoute', {
      apiId: mailHttpApi.ref,
      routeKey: 'ANY /gmail-viewer',
      target: `integrations/${mailIntegration.ref}`,
    });

    new apigatewayv2.CfnRoute(this, 'GmailViewerProxyRoute', {
      apiId: mailHttpApi.ref,
      routeKey: 'ANY /gmail-viewer/{proxy+}',
      target: `integrations/${mailIntegration.ref}`,
    });

    const ssmBaseUrl = new ssm.StringParameter(this, 'SsmBaseUrl', {
      parameterName: `${ssmPrefix}/env/BASE_URL`,
      stringValue: baseUrl,
      type: ssm.ParameterType.STRING,
    });
    (ssmBaseUrl.node.defaultChild as ssm.CfnParameter).cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const ssmGoogleClientId = new ssm.StringParameter(this, 'SsmGoogleClientId', {
      parameterName: `${ssmPrefix}/env/GOOGLE_CLIENT_ID`,
      stringValue: googleClientId,
      type: ssm.ParameterType.STRING,
    });
    (ssmGoogleClientId.node.defaultChild as ssm.CfnParameter).cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const ssmGoogleClientSecret = new ssm.StringParameter(this, 'SsmGoogleClientSecret', {
      parameterName: `${ssmPrefix}/secrets/GOOGLE_CLIENT_SECRET`,
      stringValue: googleClientSecret,
      type: ssm.ParameterType.STRING,
    });
    (ssmGoogleClientSecret.node.defaultChild as ssm.CfnParameter).cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const ssmPort = new ssm.StringParameter(this, 'SsmPort', {
      parameterName: `${ssmPrefix}/env/PORT`,
      stringValue: containerPort.toString(),
      type: ssm.ParameterType.STRING,
    });
    (ssmPort.node.defaultChild as ssm.CfnParameter).cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const ssmPublicEnv = new ssm.StringParameter(this, 'SsmPublicEnv', {
      parameterName: `${ssmPrefix}/env/NODE_ENV`,
      stringValue: publicEnvValue,
      type: ssm.ParameterType.STRING,
    });
    (ssmPublicEnv.node.defaultChild as ssm.CfnParameter).cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const ssmSessionSecret = new ssm.StringParameter(this, 'SsmSessionSecret', {
      parameterName: `${ssmPrefix}/secrets/SESSION_SECRET`,
      stringValue: sessionSecretValue,
      type: ssm.ParameterType.STRING,
    });
    (ssmSessionSecret.node.defaultChild as ssm.CfnParameter).cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    const codeBuildRole = new iam.CfnRole(this, 'CodeBuildRole', {
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'codebuild.amazonaws.com',
            },
            Action: 'sts:AssumeRole',
          },
        ],
      },
      policies: [
        {
          policyName: 'BuildLogs',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                Resource: '*',
              },
            ],
          },
        },
        {
          policyName: 'ECRPush',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: [
                  'ecr:GetAuthorizationToken',
                  'ecr:BatchCheckLayerAvailability',
                  'ecr:CompleteLayerUpload',
                  'ecr:BatchGetImage',
                  'ecr:DescribeRepositories',
                  'ecr:InitiateLayerUpload',
                  'ecr:PutImage',
                  'ecr:UploadLayerPart',
                ],
                Resource: '*',
              },
            ],
          },
        },
        {
          policyName: 'ECSDeploy',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['ecs:UpdateService', 'ecs:DescribeServices', 'ecs:DescribeClusters'],
                Resource: '*',
              },
            ],
          },
        },
        {
          policyName: 'SSMReadForBuild',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'],
                Resource: '*',
              },
            ],
          },
        },
        {
          policyName: 'CodeConnectionAccess',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: [
                "codeconnections:GetConnection",
                "codeconnections:GetConnectionToken",
                "codeconnections:UseConnection"
                ],
                Resource: props.codeConnectionArn,
              },
            ],
          },
        }
      ],
    });
    codeBuildRole.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    // Use the higher-level Project construct so we can provide a typed BuildSpec
    const codebuildRoleRef = iam.Role.fromRoleArn(this, 'CodeBuildRoleRef', codeBuildRole.attrArn);

    const codeBuildProject = new codebuild.Project(this, 'CodeBuildProject', {
      projectName: 'mail-example',
      role: codebuildRoleRef,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
        privileged: true,
        environmentVariables: {
          ECR_URI: { value: mailExampleRepository.attrRepositoryUri },
          CLUSTER_NAME: { value: mailCluster.ref },
          SERVICE_NAME: { value: 'mail-example' },
        },
      },
      source: codebuild.Source.gitHub({ owner: gitHubOwner, repo: gitHubRepo, branchOrRef: gitHubBranch, }),
      timeout: cdk.Duration.minutes(30),
      queuedTimeout: cdk.Duration.minutes(30),
      badge: true,
      description: 'Build & deploy mail-example to ECR then force ECS deploy',
      cache: codebuild.Cache.none(),
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: { commands: [
            'echo "Logging in to ECR"',
            'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $ECR_URI',
            'IMAGE_TAG=${CODEBUILD_RESOLVED_SOURCE_VERSION:-latest}',
          ]},
          build: { commands: [
            'cd examples/gmail-viewer',
            'docker build -t $ECR_URI:latest -t $ECR_URI:$IMAGE_TAG .',
          ] },
          post_build: { commands: [
            'docker push $ECR_URI:latest',
            'docker push $ECR_URI:$IMAGE_TAG',
            'aws ecs update-service --cluster $CLUSTER_NAME --service $SERVICE_NAME --force-new-deployment',
          ]},
        },
        artifacts: { files: [] },
        env: { shell: 'bash' },
      }),
    });
    (codeBuildProject.node.defaultChild as codebuild.CfnProject).cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;

    this.clusterName = mailCluster.ref;
    new cdk.CfnOutput(this, 'CfnOutputClusterName', {
      key: 'ClusterName',
      value: this.clusterName.toString(),
    });
    this.repositoryUri = mailExampleRepository.attrRepositoryUri;
    new cdk.CfnOutput(this, 'CfnOutputRepositoryUri', {
      key: 'RepositoryUri',
      value: this.repositoryUri.toString(),
    });
    this.apiInvokeUrl = baseUrl.toString();
    new cdk.CfnOutput(this, 'CfnOutputApiInvokeUrl', {
      key: 'ApiInvokeUrl',
      value: this.apiInvokeUrl,
    });
    this.cloudMapServiceArn = appCloudMapService.attrArn;
    new cdk.CfnOutput(this, 'CfnOutputCloudMapServiceArn', {
      key: 'CloudMapServiceArn',
      value: this.cloudMapServiceArn.toString(),
    });
  }
}
