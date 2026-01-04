"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GmailViewerCdkStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const apigatewayv2 = __importStar(require("aws-cdk-lib/aws-apigatewayv2"));
const codebuild = __importStar(require("aws-cdk-lib/aws-codebuild"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const ecr = __importStar(require("aws-cdk-lib/aws-ecr"));
const ecs = __importStar(require("aws-cdk-lib/aws-ecs"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const route53 = __importStar(require("aws-cdk-lib/aws-route53"));
const servicediscovery = __importStar(require("aws-cdk-lib/aws-servicediscovery"));
const ssm = __importStar(require("aws-cdk-lib/aws-ssm"));
class GmailViewerCdkStack extends cdk.Stack {
    clusterName;
    repositoryUri;
    apiInvokeUrl;
    cloudMapServiceArn;
    constructor(scope, id, props) {
        super(scope, id, props);
        const toNumber = (value, fallback) => {
            const candidate = value ?? fallback;
            const parsed = typeof candidate === 'number' ? candidate : Number(candidate);
            return Number.isFinite(parsed) ? parsed : fallback;
        };
        const toCpuUnits = (value) => {
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
        let vpc;
        let privateSubnetIds;
        let serviceSubnetIds;
        // If account/region are available, use Vpc.fromLookup to automatically discover subnets.
        // Otherwise fall back to CloudFormation parameters which let the deployer pick values in the console.
        const useVpcParameter = this.node.tryGetContext('useVpcParameter');
        if (!useVpcParameter && this.account && this.region) {
            vpc = ec2.Vpc.fromLookup(this, 'MailVpc', { tags: { Name: 'dya-vpc' } });
            if (props.privateSubnets && props.privateSubnets.length > 0) {
                privateSubnetIds = props.privateSubnets;
            }
            else {
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
        }
        else {
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
                lifecyclePolicyText: '{\n  "rules": [\n    {\n      "rulePriority": 1,\n      "description": "Expire images older than 30 days",\n      "selection": {\n        "tagStatus": "any",\n        "countType": "sinceImagePushed",\n        "countUnit": "days",\n        "countNumber": 30\n      },\n      "action": { "type": "expire" }\n    }\n  ]\n}\n',
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
                        certificateArn: certificateArn,
                        endpointType: 'REGIONAL',
                        securityPolicy: 'TLS_1_2',
                    },
                ],
            })
            : undefined;
        if (apiDomainName) {
            apiDomainName.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;
        }
        const apiMapping = hasCustomDomain && apiDomainName
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
        const apiDomainRecord = hasCustomDomain && hasHostedZone && apiDomainName
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
        ssmBaseUrl.node.defaultChild.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;
        const ssmGoogleClientId = new ssm.StringParameter(this, 'SsmGoogleClientId', {
            parameterName: `${ssmPrefix}/env/GOOGLE_CLIENT_ID`,
            stringValue: googleClientId,
            type: ssm.ParameterType.STRING,
        });
        ssmGoogleClientId.node.defaultChild.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;
        const ssmGoogleClientSecret = new ssm.StringParameter(this, 'SsmGoogleClientSecret', {
            parameterName: `${ssmPrefix}/secrets/GOOGLE_CLIENT_SECRET`,
            stringValue: googleClientSecret,
            type: ssm.ParameterType.STRING,
        });
        ssmGoogleClientSecret.node.defaultChild.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;
        const ssmPort = new ssm.StringParameter(this, 'SsmPort', {
            parameterName: `${ssmPrefix}/env/PORT`,
            stringValue: containerPort.toString(),
            type: ssm.ParameterType.STRING,
        });
        ssmPort.node.defaultChild.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;
        const ssmPublicEnv = new ssm.StringParameter(this, 'SsmPublicEnv', {
            parameterName: `${ssmPrefix}/env/NODE_ENV`,
            stringValue: publicEnvValue,
            type: ssm.ParameterType.STRING,
        });
        ssmPublicEnv.node.defaultChild.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;
        const ssmSessionSecret = new ssm.StringParameter(this, 'SsmSessionSecret', {
            parameterName: `${ssmPrefix}/secrets/SESSION_SECRET`,
            stringValue: sessionSecretValue,
            type: ssm.ParameterType.STRING,
        });
        ssmSessionSecret.node.defaultChild.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;
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
                        ] },
                    build: { commands: [
                            'cd examples/gmail-viewer',
                            'docker build -t $ECR_URI:latest -t $ECR_URI:$IMAGE_TAG .',
                        ] },
                    post_build: { commands: [
                            'docker push $ECR_URI:latest',
                            'docker push $ECR_URI:$IMAGE_TAG',
                            'aws ecs update-service --cluster $CLUSTER_NAME --service $SERVICE_NAME --force-new-deployment',
                        ] },
                },
                artifacts: { files: [] },
                env: { shell: 'bash' },
            }),
        });
        codeBuildProject.node.defaultChild.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.DELETE;
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
exports.GmailViewerCdkStack = GmailViewerCdkStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ21haWwtdmlld2VyLWNkay1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImdtYWlsLXZpZXdlci1jZGstc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLDJFQUE2RDtBQUM3RCxxRUFBdUQ7QUFDdkQseURBQTJDO0FBQzNDLHlEQUEyQztBQUMzQyx5REFBMkM7QUFDM0MseURBQTJDO0FBQzNDLDJEQUE2QztBQUM3QyxpRUFBbUQ7QUFDbkQsbUZBQXFFO0FBQ3JFLHlEQUEyQztBQTBCM0MsTUFBYSxtQkFBb0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUNoQyxXQUFXLENBQVM7SUFDcEIsYUFBYSxDQUFTO0lBQ3RCLFlBQVksQ0FBUztJQUNyQixrQkFBa0IsQ0FBUztJQUUzQyxZQUFtQixLQUFjLEVBQUUsRUFBVSxFQUFFLEtBQStCO1FBQzVFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sUUFBUSxHQUFHLENBQUMsS0FBa0MsRUFBRSxRQUFnQixFQUFVLEVBQUU7WUFDaEYsTUFBTSxTQUFTLEdBQUcsS0FBSyxJQUFJLFFBQVEsQ0FBQztZQUNwQyxNQUFNLE1BQU0sR0FBRyxPQUFPLFNBQVMsS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1lBQzdFLE9BQU8sTUFBTSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUM7UUFDckQsQ0FBQyxDQUFDO1FBRUYsTUFBTSxVQUFVLEdBQUcsQ0FBQyxLQUFrQyxFQUFVLEVBQUU7WUFDaEUsTUFBTSxNQUFNLEdBQUcsUUFBUSxDQUFDLEtBQUssRUFBRSxHQUFHLENBQUMsQ0FBQztZQUNwQyxN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QUksRUFBRSw2QkFBNkIsRUFBRTtZQUNyRCxHQUFHLEVBQUUsb0JBQW9CO1lBQ3pCLEtBQUssRUFBRSxJQUFJLENBQUMsa0JBQWtCLENBQUMsUUFBUSxFQUFFO1NBQzFDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQXpwQkQsa0RBeXBCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBhcGlnYXRld2F5djIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXl2Mic7XG5pbXBvcnQgKiBhcyBjb2RlYnVpbGQgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZGVidWlsZCc7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgKiBhcyBlY3IgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcic7XG5pbXBvcnQgKiBhcyBlY3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcyc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCAqIGFzIHJvdXRlNTMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXJvdXRlNTMnO1xuaW1wb3J0ICogYXMgc2VydmljZWRpc2NvdmVyeSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VydmljZWRpc2NvdmVyeSc7XG5pbXBvcnQgKiBhcyBzc20gZnJvbSAnYXdzLWNkay1saWIvYXdzLXNzbSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgR21haWxWaWV3ZXJDZGtTdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICByZWFkb25seSB2cGNJZD86IHN0cmluZztcbiAgcmVhZG9ubHkgcHJpdmF0ZVN1Ym5ldHM/OiBzdHJpbmdbXTtcbiAgcmVhZG9ubHkgY29udGFpbmVyUG9ydD86IG51bWJlciB8IHN0cmluZztcbiAgcmVhZG9ubHkgY29udGFpbmVyQ3B1PzogbnVtYmVyIHwgc3RyaW5nO1xuICByZWFkb25seSBjb250YWluZXJNZW1vcnk/OiBudW1iZXIgfCBzdHJpbmc7XG4gIHJlYWRvbmx5IGRlc2lyZWRDb3VudD86IG51bWJlciB8IHN0cmluZztcbiAgcmVhZG9ubHkgY2VydGlmaWNhdGVBcm4/OiBzdHJpbmc7XG4gIHJlYWRvbmx5IGFwaUN1c3RvbURvbWFpbk5hbWU/OiBzdHJpbmc7XG4gIHJlYWRvbmx5IGhvc3RlZFpvbmVJZD86IHN0cmluZztcbiAgcmVhZG9ubHkgc2VydmljZURpc2NvdmVyeU5hbWVzcGFjZU5hbWU/OiBzdHJpbmc7XG4gIHJlYWRvbmx5IHNlcnZpY2VEaXNjb3ZlcnlUdGw/OiBudW1iZXIgfCBzdHJpbmc7XG4gIHJlYWRvbmx5IHNzbVByZWZpeD86IHN0cmluZztcbiAgcmVhZG9ubHkgZ2l0SHViT3duZXI/OiBzdHJpbmc7XG4gIHJlYWRvbmx5IGdpdEh1YlJlcG8/OiBzdHJpbmc7XG4gIHJlYWRvbmx5IGdpdEh1YkJyYW5jaD86IHN0cmluZztcbiAgcmVhZG9ubHkgcHVibGljRW52VmFsdWU/OiBzdHJpbmc7XG4gIHJlYWRvbmx5IGdvb2dsZUNsaWVudElkPzogc3RyaW5nO1xuICByZWFkb25seSBnb29nbGVDbGllbnRTZWNyZXQ/OiBzdHJpbmc7XG4gIHJlYWRvbmx5IHNlc3Npb25TZWNyZXRWYWx1ZT86IHN0cmluZztcbiAgcmVhZG9ubHkgdXNlR2l0SHViV2ViaG9va3M/OiBib29sZWFuO1xuICByZWFkb25seSBjb2RlQ29ubmVjdGlvbkFybj86IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIEdtYWlsVmlld2VyQ2RrU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgY2x1c3Rlck5hbWU6IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IHJlcG9zaXRvcnlVcmk6IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IGFwaUludm9rZVVybDogc3RyaW5nO1xuICBwdWJsaWMgcmVhZG9ubHkgY2xvdWRNYXBTZXJ2aWNlQXJuOiBzdHJpbmc7XG5cbiAgcHVibGljIGNvbnN0cnVjdG9yKHNjb3BlOiBjZGsuQXBwLCBpZDogc3RyaW5nLCBwcm9wczogR21haWxWaWV3ZXJDZGtTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB0b051bWJlciA9ICh2YWx1ZTogc3RyaW5nIHwgbnVtYmVyIHwgdW5kZWZpbmVkLCBmYWxsYmFjazogbnVtYmVyKTogbnVtYmVyID0+IHtcbiAgICAgIGNvbnN0IGNhbmRpZGF0ZSA9IHZhbHVlID8/IGZhbGxiYWNrO1xuICAgICAgY29uc3QgcGFyc2VkID0gdHlwZW9mIGNhbmRpZGF0ZSA9PT0gJ251bWJlcicgPyBjYW5kaWRhdGUgOiBOdW1iZXIoY2FuZGlkYXRlKTtcbiAgICAgIHJldHVybiBOdW1iZXIuaXNGaW5pdGUocGFyc2VkKSA/IHBhcnNlZCA6IGZhbGxiYWNrO1xuICAgIH07XG5cbiAgICBjb25zdCB0b0NwdVVuaXRzID0gKHZhbHVlOiBzdHJpbmcgfCBudW1iZXIgfCB1bmRlZmluZWQpOiBudW1iZXIgPT4ge1xuICAgICAgY29uc3QgcGFyc2VkID0gdG9OdW1iZXIodmFsdWUsIDAuNSk7XG4gICAgICBjb25zdCB2Y3B1ID0gcGFyc2VkIDw9IDQgPyBwYXJzZWQgKiAxMDI0IDogcGFyc2VkO1xuICAgICAgY29uc3Qgcm91bmRlZCA9IE1hdGgucm91bmQodmNwdSAvIDI1NikgKiAyNTY7XG4gICAgICByZXR1cm4gTWF0aC5tYXgoMjU2LCByb3VuZGVkKTtcbiAgICB9O1xuXG4gICAgY29uc3QgcmVwb1BhcnRzID0gKHByb2Nlc3MuZW52LkdJVEhVQl9SRVBPU0lUT1JZID8/ICcnKS5zcGxpdCgnLycpO1xuICAgIGNvbnN0IGd1ZXNzZWRHaXRIdWJPd25lciA9IHJlcG9QYXJ0c1swXSB8fCAnZHlhbmV0JztcbiAgICBjb25zdCBndWVzc2VkR2l0SHViUmVwbyA9IHJlcG9QYXJ0c1sxXSB8fCAnaW1hcCc7XG5cbiAgICBjb25zdCBjb250YWluZXJQb3J0ID0gdG9OdW1iZXIocHJvcHMuY29udGFpbmVyUG9ydCwgMzAwMCk7XG4gICAgY29uc3QgY29udGFpbmVyQ3B1ID0gdG9DcHVVbml0cyhwcm9wcy5jb250YWluZXJDcHUpO1xuICAgIGNvbnN0IGNvbnRhaW5lck1lbW9yeSA9IHRvTnVtYmVyKHByb3BzLmNvbnRhaW5lck1lbW9yeSwgMTAyNCk7XG4gICAgY29uc3QgZGVzaXJlZENvdW50ID0gdG9OdW1iZXIocHJvcHMuZGVzaXJlZENvdW50LCAxKTtcbiAgICBjb25zdCBzZXJ2aWNlRGlzY292ZXJ5TmFtZXNwYWNlTmFtZSA9IHByb3BzLnNlcnZpY2VEaXNjb3ZlcnlOYW1lc3BhY2VOYW1lID8/ICdtYWlsLmxvY2FsJztcbiAgICBjb25zdCBzZXJ2aWNlRGlzY292ZXJ5VHRsID0gdG9OdW1iZXIocHJvcHMuc2VydmljZURpc2NvdmVyeVR0bCwgNjApO1xuICAgIGNvbnN0IHNzbVByZWZpeFJhdyA9IHByb3BzLnNzbVByZWZpeCA/PyAnL21haWwtZXhhbXBsZSc7XG4gICAgY29uc3Qgc3NtUHJlZml4ID0gJy8nICsgc3NtUHJlZml4UmF3LnNwbGl0KCcvJykuZmlsdGVyKHAgPT4gcCkuam9pbignLycpO1xuICAgIGNvbnN0IGdpdEh1Yk93bmVyID0gcHJvcHMuZ2l0SHViT3duZXIgPz8gZ3Vlc3NlZEdpdEh1Yk93bmVyO1xuICAgIGNvbnN0IGdpdEh1YlJlcG8gPSBwcm9wcy5naXRIdWJSZXBvID8/IGd1ZXNzZWRHaXRIdWJSZXBvO1xuICAgIGNvbnN0IGdpdEh1YkJyYW5jaCA9IHByb3BzLmdpdEh1YkJyYW5jaCA/PyBwcm9jZXNzLmVudi5HSVRIVUJfUkVGX05BTUUgPz8gJ21haW4nO1xuICAgIGNvbnN0IHB1YmxpY0VudlZhbHVlID0gcHJvcHMucHVibGljRW52VmFsdWUgPz8gJ3Byb2R1Y3Rpb24nO1xuICAgIGNvbnN0IGdvb2dsZUNsaWVudElkID0gcHJvcHMuZ29vZ2xlQ2xpZW50SWQgfHwgJ25vdC1zZXQnO1xuICAgIGNvbnN0IGdvb2dsZUNsaWVudFNlY3JldCA9IHByb3BzLmdvb2dsZUNsaWVudFNlY3JldCA/PyAnbm90LXNldCc7XG4gICAgY29uc3Qgc2Vzc2lvblNlY3JldFZhbHVlID0gcHJvcHMuc2Vzc2lvblNlY3JldFZhbHVlID8/ICdub3Qtc2V0JztcbiAgICBjb25zdCBhcGlDdXN0b21Eb21haW5OYW1lID0gcHJvcHMuYXBpQ3VzdG9tRG9tYWluTmFtZSA/PyBwcm9jZXNzLmVudi5BUElfQ1VTVE9NX0RPTUFJTiA/PyAnbWFpbC5keWFuZXQuY29tJztcbiAgICBjb25zdCBjZXJ0aWZpY2F0ZUFybiA9IHByb3BzLmNlcnRpZmljYXRlQXJuID8/IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdjZXJ0aWZpY2F0ZUFybicpID8/IHByb2Nlc3MuZW52LkNFUlRJRklDQVRFX0FSTjtcbiAgICBjb25zdCBob3N0ZWRab25lSWQgPSBwcm9wcy5ob3N0ZWRab25lSWQgPz8gJyc7XG4gICAgY29uc3QgaGFzQ3VzdG9tRG9tYWluID0gQm9vbGVhbihjZXJ0aWZpY2F0ZUFybiAmJiBhcGlDdXN0b21Eb21haW5OYW1lKTtcbiAgICBjb25zdCBoYXNIb3N0ZWRab25lID0gQm9vbGVhbihob3N0ZWRab25lSWQpO1xuXG4gICAgbGV0IHZwYzogZWMyLklWcGM7XG4gICAgbGV0IHByaXZhdGVTdWJuZXRJZHM6IHN0cmluZ1tdO1xuICAgIGxldCBzZXJ2aWNlU3VibmV0SWRzOiBzdHJpbmdbXTtcblxuICAgIC8vIElmIGFjY291bnQvcmVnaW9uIGFyZSBhdmFpbGFibGUsIHVzZSBWcGMuZnJvbUxvb2t1cCB0byBhdXRvbWF0aWNhbGx5IGRpc2NvdmVyIHN1Ym5ldHMuXG4gICAgLy8gT3RoZXJ3aXNlIGZhbGwgYmFjayB0byBDbG91ZEZvcm1hdGlvbiBwYXJhbWV0ZXJzIHdoaWNoIGxldCB0aGUgZGVwbG95ZXIgcGljayB2YWx1ZXMgaW4gdGhlIGNvbnNvbGUuXG4gICAgY29uc3QgdXNlVnBjUGFyYW1ldGVyID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ3VzZVZwY1BhcmFtZXRlcicpO1xuXG4gICAgaWYgKCF1c2VWcGNQYXJhbWV0ZXIgJiYgdGhpcy5hY2NvdW50ICYmIHRoaXMucmVnaW9uKSB7XG4gICAgICB2cGMgPSBlYzIuVnBjLmZyb21Mb29rdXAodGhpcywgJ01haWxWcGMnLCB7IHRhZ3M6IHsgTmFtZTogJ2R5YS12cGMnIH0gfSk7XG4gICAgICBcbiAgICAgIGlmIChwcm9wcy5wcml2YXRlU3VibmV0cyAmJiBwcm9wcy5wcml2YXRlU3VibmV0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgcHJpdmF0ZVN1Ym5ldElkcyA9IHByb3BzLnByaXZhdGVTdWJuZXRzO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBUaGUgc2VydmljZSBsaW5rZWQgdG8gdGhlIFZQQyBMaW5rIG1heSBub3QgYmUgYXZhaWxhYmxlIGluIGFsbCBBdmFpbGFiaWxpdHkgWm9uZXMuXG4gICAgICAgICAgY29uc3QgYmFkQXogPSAnY2FjMS1hejQnO1xuICAgICAgICAgIFxuICAgICAgICAgIGxldCBzdWJuZXRzID0gdnBjLnByaXZhdGVTdWJuZXRzLmZpbHRlcihzID0+IHMuYXZhaWxhYmlsaXR5Wm9uZSAhPT0gYmFkQXopO1xuICAgICAgICAgIGlmIChzdWJuZXRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgLy8gTm8gcHJpdmF0ZSBzdWJuZXRzLCB0cnkgcHVibGljIHN1Ym5ldHNcbiAgICAgICAgICAgIHN1Ym5ldHMgPSB2cGMucHVibGljU3VibmV0cy5maWx0ZXIocyA9PiBzLmF2YWlsYWJpbGl0eVpvbmUgIT09IGJhZEF6KTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBwcml2YXRlU3VibmV0SWRzID0gc3VibmV0cy5zbGljZSgwLCAyKS5tYXAocyA9PiBzLnN1Ym5ldElkKTtcbiAgICAgICAgICBcbiAgICAgICAgICBpZiAocHJpdmF0ZVN1Ym5ldElkcy5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFZQQyAnJHt2cGMudnBjSWR9JyBtdXN0IGhhdmUgYXQgbGVhc3Qgb25lIHByaXZhdGUgb3IgcHVibGljIHN1Ym5ldCBpbiBhbiBhbGxvd2VkIGF2YWlsYWJpbGl0eSB6b25lIChub3QgaW4gJHtiYWRBen0pLmApO1xuICAgICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHNlcnZpY2VTdWJuZXRJZHMgPSBwcml2YXRlU3VibmV0SWRzO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBDbG91ZEZvcm1hdGlvbiBwYXJhbWV0ZXIgZm9yIFZQQyBzZWxlY3Rpb24gKGRyb3Bkb3duIG9mIFZQQyBJRHMgaW4gdGhlIGNvbnNvbGUpXG4gICAgICBjb25zdCB2cGNJZFBhcmFtID0gbmV3IGNkay5DZm5QYXJhbWV0ZXIodGhpcywgJ1ZwY0lkUGFyYW0nLCB7XG4gICAgICAgIHR5cGU6ICdBV1M6OkVDMjo6VlBDOjpJZCcsXG4gICAgICAgIGRlZmF1bHQ6IHByb3BzLnZwY0lkID8/ICcnLFxuICAgICAgfSk7XG5cbiAgICAgIC8vIE9wdGlvbmFsIHBhcmFtZXRlciBmb3IgcHJpdmF0ZSBzdWJuZXQgSURzIChDb21tYURlbGltaXRlZExpc3QpIHdoZW4gc3ludGhlc2l6aW5nIHdpdGhvdXQgYWNjb3VudC9yZWdpb25cbiAgICAgIGNvbnN0IHByaXZhdGVTdWJuZXRJZHNQYXJhbSA9IG5ldyBjZGsuQ2ZuUGFyYW1ldGVyKHRoaXMsICdQcml2YXRlU3VibmV0SWRzUGFyYW0nLCB7XG4gICAgICAgIHR5cGU6ICdDb21tYURlbGltaXRlZExpc3QnLFxuICAgICAgICBkZWZhdWx0OiBwcm9wcy5wcml2YXRlU3VibmV0cyAmJiBwcm9wcy5wcml2YXRlU3VibmV0cy5sZW5ndGggPiAwID8gcHJvcHMucHJpdmF0ZVN1Ym5ldHMuam9pbignLCcpIDogJycsXG4gICAgICB9KTtcbiAgICAgIC8vIFVzZSB0aGUgcHJvdmlkZWQgcGFyYW1ldGVyIHZhbHVlcyAoZGVwbG95ZXIgbXVzdCBzdXBwbHkgcHJpdmF0ZSBzdWJuZXQgaWRzIHdoZW4gc3ludGhlc2l6aW5nIHdpdGhvdXQgbG9va3VwKVxuICAgICAgdnBjID0gZWMyLlZwYy5mcm9tVnBjQXR0cmlidXRlcyh0aGlzLCAnTWFpbFZwYycsIHtcbiAgICAgICAgdnBjSWQ6IHZwY0lkUGFyYW0udmFsdWVBc1N0cmluZyxcbiAgICAgICAgYXZhaWxhYmlsaXR5Wm9uZXM6IGNkay5Gbi5nZXRBenMoKSxcbiAgICAgICAgcHJpdmF0ZVN1Ym5ldElkczogcHJpdmF0ZVN1Ym5ldElkc1BhcmFtLnZhbHVlQXNMaXN0LFxuICAgICAgfSk7XG4gICAgICBwcml2YXRlU3VibmV0SWRzID0gcHJvcHMucHJpdmF0ZVN1Ym5ldHMgPz8gcHJpdmF0ZVN1Ym5ldElkc1BhcmFtLnZhbHVlQXNMaXN0O1xuICAgICAgc2VydmljZVN1Ym5ldElkcyA9IHByaXZhdGVTdWJuZXRJZHM7XG4gICAgfVxuXG4gICAgY29uc3QgYXBpVnBjTGlua1NlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLkNmblNlY3VyaXR5R3JvdXAodGhpcywgJ0FwaVZwY0xpbmtTZWN1cml0eUdyb3VwJywge1xuICAgICAgZ3JvdXBEZXNjcmlwdGlvbjogJ0VncmVzcyBmcm9tIEFQSSBHYXRld2F5IFZQQyBMaW5rIHRvIHNlcnZpY2UnLFxuICAgICAgdnBjSWQ6IHZwYy52cGNJZCxcbiAgICAgIHNlY3VyaXR5R3JvdXBFZ3Jlc3M6IFtcbiAgICAgICAge1xuICAgICAgICAgIGlwUHJvdG9jb2w6ICd0Y3AnLFxuICAgICAgICAgIGZyb21Qb3J0OiBjb250YWluZXJQb3J0LFxuICAgICAgICAgIHRvUG9ydDogY29udGFpbmVyUG9ydCxcbiAgICAgICAgICBjaWRySXA6ICcwLjAuMC4wLzAnLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcbiAgICBhcGlWcGNMaW5rU2VjdXJpdHlHcm91cC5jZm5PcHRpb25zLmRlbGV0aW9uUG9saWN5ID0gY2RrLkNmbkRlbGV0aW9uUG9saWN5LkRFTEVURTtcblxuICAgIGNvbnN0IHNlcnZpY2VTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5DZm5TZWN1cml0eUdyb3VwKHRoaXMsICdTZXJ2aWNlU2VjdXJpdHlHcm91cCcsIHtcbiAgICAgIGdyb3VwRGVzY3JpcHRpb246ICdBbGxvdyBBUEkgR2F0ZXdheSBWUEMgTGluayB0byByZWFjaCBGYXJnYXRlIHRhc2tzJyxcbiAgICAgIHZwY0lkOiB2cGMudnBjSWQsXG4gICAgICBzZWN1cml0eUdyb3VwSW5ncmVzczogW1xuICAgICAgICB7XG4gICAgICAgICAgaXBQcm90b2NvbDogJ3RjcCcsXG4gICAgICAgICAgZnJvbVBvcnQ6IGNvbnRhaW5lclBvcnQsXG4gICAgICAgICAgdG9Qb3J0OiBjb250YWluZXJQb3J0LFxuICAgICAgICAgIGNpZHJJcDogJzAuMC4wLjAvMCcsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgc2VjdXJpdHlHcm91cEVncmVzczogW1xuICAgICAgICB7XG4gICAgICAgICAgaXBQcm90b2NvbDogJy0xJyxcbiAgICAgICAgICBmcm9tUG9ydDogMCxcbiAgICAgICAgICB0b1BvcnQ6IDY1NTM1LFxuICAgICAgICAgIGNpZHJJcDogJzAuMC4wLjAvMCcsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuICAgIHNlcnZpY2VTZWN1cml0eUdyb3VwLmNmbk9wdGlvbnMuZGVsZXRpb25Qb2xpY3kgPSBjZGsuQ2ZuRGVsZXRpb25Qb2xpY3kuREVMRVRFO1xuXG4gICAgY29uc3QgYXBwTG9nR3JvdXAgPSBuZXcgbG9ncy5DZm5Mb2dHcm91cCh0aGlzLCAnQXBwTG9nR3JvdXAnLCB7XG4gICAgICBsb2dHcm91cE5hbWU6ICcvZWNzL21haWwtZXhhbXBsZScsXG4gICAgICByZXRlbnRpb25JbkRheXM6IDMwLFxuICAgIH0pO1xuICAgIGFwcExvZ0dyb3VwLmNmbk9wdGlvbnMuZGVsZXRpb25Qb2xpY3kgPSBjZGsuQ2ZuRGVsZXRpb25Qb2xpY3kuREVMRVRFO1xuXG4gICAgY29uc3QgbWFpbENsdXN0ZXIgPSBuZXcgZWNzLkNmbkNsdXN0ZXIodGhpcywgJ01haWxDbHVzdGVyJywge1xuICAgICAgY2x1c3Rlck5hbWU6ICdtYWlsLWNsdXN0ZXInLFxuICAgICAgY2FwYWNpdHlQcm92aWRlcnM6IFsnRkFSR0FURScsICdGQVJHQVRFX1NQT1QnXSxcbiAgICAgIGRlZmF1bHRDYXBhY2l0eVByb3ZpZGVyU3RyYXRlZ3k6IFtcbiAgICAgICAge1xuICAgICAgICAgIGNhcGFjaXR5UHJvdmlkZXI6ICdGQVJHQVRFX1NQT1QnLFxuICAgICAgICAgIHdlaWdodDogNCxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGNhcGFjaXR5UHJvdmlkZXI6ICdGQVJHQVRFJyxcbiAgICAgICAgICB3ZWlnaHQ6IDEsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuICAgIG1haWxDbHVzdGVyLmNmbk9wdGlvbnMuZGVsZXRpb25Qb2xpY3kgPSBjZGsuQ2ZuRGVsZXRpb25Qb2xpY3kuREVMRVRFO1xuXG4gICAgY29uc3QgbWFpbEV4YW1wbGVSZXBvc2l0b3J5ID0gbmV3IGVjci5DZm5SZXBvc2l0b3J5KHRoaXMsICdNYWlsRXhhbXBsZVJlcG9zaXRvcnknLCB7XG4gICAgICByZXBvc2l0b3J5TmFtZTogJ21haWwtZXhhbXBsZScsXG4gICAgICBpbWFnZVRhZ011dGFiaWxpdHk6ICdNVVRBQkxFJyxcbiAgICAgIGVuY3J5cHRpb25Db25maWd1cmF0aW9uOiB7XG4gICAgICAgIGVuY3J5cHRpb25UeXBlOiAnQUVTMjU2JyxcbiAgICAgIH0sXG4gICAgICBsaWZlY3ljbGVQb2xpY3k6IHtcbiAgICAgICAgbGlmZWN5Y2xlUG9saWN5VGV4dDpcbiAgICAgICAgICAne1xcbiAgXCJydWxlc1wiOiBbXFxuICAgIHtcXG4gICAgICBcInJ1bGVQcmlvcml0eVwiOiAxLFxcbiAgICAgIFwiZGVzY3JpcHRpb25cIjogXCJFeHBpcmUgaW1hZ2VzIG9sZGVyIHRoYW4gMzAgZGF5c1wiLFxcbiAgICAgIFwic2VsZWN0aW9uXCI6IHtcXG4gICAgICAgIFwidGFnU3RhdHVzXCI6IFwiYW55XCIsXFxuICAgICAgICBcImNvdW50VHlwZVwiOiBcInNpbmNlSW1hZ2VQdXNoZWRcIixcXG4gICAgICAgIFwiY291bnRVbml0XCI6IFwiZGF5c1wiLFxcbiAgICAgICAgXCJjb3VudE51bWJlclwiOiAzMFxcbiAgICAgIH0sXFxuICAgICAgXCJhY3Rpb25cIjogeyBcInR5cGVcIjogXCJleHBpcmVcIiB9XFxuICAgIH1cXG4gIF1cXG59XFxuJyxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgbWFpbEV4YW1wbGVSZXBvc2l0b3J5LmNmbk9wdGlvbnMuZGVsZXRpb25Qb2xpY3kgPSBjZGsuQ2ZuRGVsZXRpb25Qb2xpY3kuREVMRVRFO1xuXG4gICAgY29uc3QgbWFpbEh0dHBBcGkgPSBuZXcgYXBpZ2F0ZXdheXYyLkNmbkFwaSh0aGlzLCAnTWFpbEh0dHBBcGknLCB7XG4gICAgICBuYW1lOiAnbWFpbC1leGFtcGxlJyxcbiAgICAgIHByb3RvY29sVHlwZTogJ0hUVFAnLFxuICAgIH0pO1xuICAgIG1haWxIdHRwQXBpLmNmbk9wdGlvbnMuZGVsZXRpb25Qb2xpY3kgPSBjZGsuQ2ZuRGVsZXRpb25Qb2xpY3kuREVMRVRFO1xuXG4gICAgY29uc3QgbWFpbEFwaVN0YWdlID0gbmV3IGFwaWdhdGV3YXl2Mi5DZm5TdGFnZSh0aGlzLCAnTWFpbEFwaVN0YWdlJywge1xuICAgICAgc3RhZ2VOYW1lOiAncHJvZCcsXG4gICAgICBhcGlJZDogbWFpbEh0dHBBcGkucmVmLFxuICAgICAgYXV0b0RlcGxveTogdHJ1ZSxcbiAgICB9KTtcbiAgICBtYWlsQXBpU3RhZ2UuY2ZuT3B0aW9ucy5kZWxldGlvblBvbGljeSA9IGNkay5DZm5EZWxldGlvblBvbGljeS5ERUxFVEU7XG5cbiAgICBjb25zdCBhcGlEb21haW5OYW1lID0gaGFzQ3VzdG9tRG9tYWluXG4gICAgICA/IG5ldyBhcGlnYXRld2F5djIuQ2ZuRG9tYWluTmFtZSh0aGlzLCAnQXBpRG9tYWluTmFtZScsIHtcbiAgICAgICAgICBkb21haW5OYW1lOiBhcGlDdXN0b21Eb21haW5OYW1lLFxuICAgICAgICAgIGRvbWFpbk5hbWVDb25maWd1cmF0aW9uczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBjZXJ0aWZpY2F0ZUFybjogY2VydGlmaWNhdGVBcm4hLFxuICAgICAgICAgICAgICBlbmRwb2ludFR5cGU6ICdSRUdJT05BTCcsXG4gICAgICAgICAgICAgIHNlY3VyaXR5UG9saWN5OiAnVExTXzFfMicsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH0pXG4gICAgICA6IHVuZGVmaW5lZDtcbiAgICBpZiAoYXBpRG9tYWluTmFtZSkge1xuICAgICAgYXBpRG9tYWluTmFtZS5jZm5PcHRpb25zLmRlbGV0aW9uUG9saWN5ID0gY2RrLkNmbkRlbGV0aW9uUG9saWN5LkRFTEVURTtcbiAgICB9XG5cbiAgICBjb25zdCBhcGlNYXBwaW5nID1cbiAgICAgIGhhc0N1c3RvbURvbWFpbiAmJiBhcGlEb21haW5OYW1lXG4gICAgICAgID8gbmV3IGFwaWdhdGV3YXl2Mi5DZm5BcGlNYXBwaW5nKHRoaXMsICdBcGlNYXBwaW5nJywge1xuICAgICAgICAgICAgYXBpSWQ6IG1haWxIdHRwQXBpLnJlZixcbiAgICAgICAgICAgIGRvbWFpbk5hbWU6IGFwaURvbWFpbk5hbWUucmVmLFxuICAgICAgICAgICAgc3RhZ2U6IG1haWxBcGlTdGFnZS5yZWYsXG4gICAgICAgICAgICBhcGlNYXBwaW5nS2V5OiAnZXhhbXBsZXMnLFxuICAgICAgICAgIH0pXG4gICAgICAgIDogdW5kZWZpbmVkO1xuICAgIGlmIChhcGlNYXBwaW5nKSB7XG4gICAgICBhcGlNYXBwaW5nLmNmbk9wdGlvbnMuZGVsZXRpb25Qb2xpY3kgPSBjZGsuQ2ZuRGVsZXRpb25Qb2xpY3kuREVMRVRFO1xuICAgIH1cblxuICAgIGNvbnN0IGFwaURvbWFpblJlY29yZCA9XG4gICAgICBoYXNDdXN0b21Eb21haW4gJiYgaGFzSG9zdGVkWm9uZSAmJiBhcGlEb21haW5OYW1lXG4gICAgICAgID8gbmV3IHJvdXRlNTMuQ2ZuUmVjb3JkU2V0KHRoaXMsICdBcGlEb21haW5SZWNvcmQnLCB7XG4gICAgICAgICAgICBob3N0ZWRab25lSWQsXG4gICAgICAgICAgICBuYW1lOiBhcGlDdXN0b21Eb21haW5OYW1lLFxuICAgICAgICAgICAgdHlwZTogJ0EnLFxuICAgICAgICAgICAgYWxpYXNUYXJnZXQ6IHtcbiAgICAgICAgICAgICAgZG5zTmFtZTogYXBpRG9tYWluTmFtZS5hdHRyUmVnaW9uYWxEb21haW5OYW1lLFxuICAgICAgICAgICAgICBob3N0ZWRab25lSWQ6IGFwaURvbWFpbk5hbWUuYXR0clJlZ2lvbmFsSG9zdGVkWm9uZUlkLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KVxuICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICBpZiAoYXBpRG9tYWluUmVjb3JkKSB7XG4gICAgICBhcGlEb21haW5SZWNvcmQuY2ZuT3B0aW9ucy5kZWxldGlvblBvbGljeSA9IGNkay5DZm5EZWxldGlvblBvbGljeS5ERUxFVEU7XG4gICAgfVxuICAgIGlmIChhcGlNYXBwaW5nICYmIGFwaURvbWFpbk5hbWUpIHtcbiAgICAgIGFwaU1hcHBpbmcuYWRkRGVwZW5kZW5jeShhcGlEb21haW5OYW1lKTtcbiAgICAgIGFwaU1hcHBpbmcuYWRkRGVwZW5kZW5jeShtYWlsQXBpU3RhZ2UpO1xuICAgIH1cbiAgICBpZiAoYXBpRG9tYWluUmVjb3JkICYmIGFwaURvbWFpbk5hbWUpIHtcbiAgICAgIGFwaURvbWFpblJlY29yZC5hZGREZXBlbmRlbmN5KGFwaURvbWFpbk5hbWUpO1xuICAgIH1cblxuICAgIGNvbnN0IGJhc2VVcmwgPSBoYXNDdXN0b21Eb21haW5cbiAgICAgID8gYGh0dHBzOi8vJHthcGlDdXN0b21Eb21haW5OYW1lfS9leGFtcGxlcy9nbWFpbC12aWV3ZXJgXG4gICAgICA6IGNkay5Gbi5qb2luKCcnLCBbbWFpbEh0dHBBcGkuYXR0ckFwaUVuZHBvaW50LCAnLycsIG1haWxBcGlTdGFnZS5yZWYsICcvZ21haWwtdmlld2VyJ10pO1xuXG4gICAgY29uc3Qgc2VydmljZU5hbWVzcGFjZSA9IG5ldyBzZXJ2aWNlZGlzY292ZXJ5LkNmblByaXZhdGVEbnNOYW1lc3BhY2UodGhpcywgJ1NlcnZpY2VOYW1lc3BhY2UnLCB7XG4gICAgICBuYW1lOiBzZXJ2aWNlRGlzY292ZXJ5TmFtZXNwYWNlTmFtZSxcbiAgICAgIHZwYzogdnBjLnZwY0lkLFxuICAgICAgZGVzY3JpcHRpb246ICdOYW1lc3BhY2UgZm9yIG1haWwgc2VydmljZXMnLFxuICAgIH0pO1xuICAgIHNlcnZpY2VOYW1lc3BhY2UuY2ZuT3B0aW9ucy5kZWxldGlvblBvbGljeSA9IGNkay5DZm5EZWxldGlvblBvbGljeS5ERUxFVEU7XG5cbiAgICBjb25zdCBhcGlWcGNMaW5rID0gbmV3IGFwaWdhdGV3YXl2Mi5DZm5WcGNMaW5rKHRoaXMsICdBcGlWcGNMaW5rJywge1xuICAgICAgbmFtZTogJ21haWwtZXhhbXBsZS12cGNsaW5rJyxcbiAgICAgIHN1Ym5ldElkczogc2VydmljZVN1Ym5ldElkcyxcbiAgICAgIHNlY3VyaXR5R3JvdXBJZHM6IFthcGlWcGNMaW5rU2VjdXJpdHlHcm91cC5yZWZdLFxuICAgIH0pO1xuICAgIGFwaVZwY0xpbmsuY2ZuT3B0aW9ucy5kZWxldGlvblBvbGljeSA9IGNkay5DZm5EZWxldGlvblBvbGljeS5ERUxFVEU7XG5cbiAgICBjb25zdCBhcHBDbG91ZE1hcFNlcnZpY2UgPSBuZXcgc2VydmljZWRpc2NvdmVyeS5DZm5TZXJ2aWNlKHRoaXMsICdBcHBDbG91ZE1hcFNlcnZpY2UnLCB7XG4gICAgICBuYW1lOiAnbWFpbC1leGFtcGxlJyxcbiAgICAgIG5hbWVzcGFjZUlkOiBzZXJ2aWNlTmFtZXNwYWNlLnJlZixcbiAgICAgIGRuc0NvbmZpZzoge1xuICAgICAgICByb3V0aW5nUG9saWN5OiAnV0VJR0hURUQnLFxuICAgICAgICBkbnNSZWNvcmRzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgdHRsOiBzZXJ2aWNlRGlzY292ZXJ5VHRsLFxuICAgICAgICAgICAgdHlwZTogJ1NSVicsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgICBoZWFsdGhDaGVja0N1c3RvbUNvbmZpZzoge1xuICAgICAgICBmYWlsdXJlVGhyZXNob2xkOiAxLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBhcHBDbG91ZE1hcFNlcnZpY2UuY2ZuT3B0aW9ucy5kZWxldGlvblBvbGljeSA9IGNkay5DZm5EZWxldGlvblBvbGljeS5ERUxFVEU7XG5cbiAgICBjb25zdCB0YXNrRXhlY3V0aW9uUm9sZSA9IG5ldyBpYW0uQ2ZuUm9sZSh0aGlzLCAnVGFza0V4ZWN1dGlvblJvbGUnLCB7XG4gICAgICBhc3N1bWVSb2xlUG9saWN5RG9jdW1lbnQ6IHtcbiAgICAgICAgVmVyc2lvbjogJzIwMTItMTAtMTcnLFxuICAgICAgICBTdGF0ZW1lbnQ6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBFZmZlY3Q6ICdBbGxvdycsXG4gICAgICAgICAgICBQcmluY2lwYWw6IHtcbiAgICAgICAgICAgICAgU2VydmljZTogJ2Vjcy10YXNrcy5hbWF6b25hd3MuY29tJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBBY3Rpb246ICdzdHM6QXNzdW1lUm9sZScsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgICBtYW5hZ2VkUG9saWN5QXJuczogWydhcm46YXdzOmlhbTo6YXdzOnBvbGljeS9zZXJ2aWNlLXJvbGUvQW1hem9uRUNTVGFza0V4ZWN1dGlvblJvbGVQb2xpY3knXSxcbiAgICAgIHBvbGljaWVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBwb2xpY3lOYW1lOiAnQWxsb3dQYXJhbWV0ZXJSZWFkRm9yU2VjcmV0cycsXG4gICAgICAgICAgcG9saWN5RG9jdW1lbnQ6IHtcbiAgICAgICAgICAgIFZlcnNpb246ICcyMDEyLTEwLTE3JyxcbiAgICAgICAgICAgIFN0YXRlbWVudDogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgRWZmZWN0OiAnQWxsb3cnLFxuICAgICAgICAgICAgICAgIEFjdGlvbjogWydzc206R2V0UGFyYW1ldGVyJywgJ3NzbTpHZXRQYXJhbWV0ZXJzJywgJ3NzbTpHZXRQYXJhbWV0ZXJzQnlQYXRoJywgJ2ttczpEZWNyeXB0J10sXG4gICAgICAgICAgICAgICAgUmVzb3VyY2U6IFtcbiAgICAgICAgICAgICAgICAgIGBhcm46YXdzOnNzbToke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06cGFyYW1ldGVyJHtzc21QcmVmaXh9KmAsXG4gICAgICAgICAgICAgICAgICBgYXJuOmF3czprbXM6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmtleS8qYCxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcbiAgICB0YXNrRXhlY3V0aW9uUm9sZS5jZm5PcHRpb25zLmRlbGV0aW9uUG9saWN5ID0gY2RrLkNmbkRlbGV0aW9uUG9saWN5LkRFTEVURTtcblxuICAgIGNvbnN0IHRhc2tSb2xlID0gbmV3IGlhbS5DZm5Sb2xlKHRoaXMsICdUYXNrUm9sZScsIHtcbiAgICAgIGFzc3VtZVJvbGVQb2xpY3lEb2N1bWVudDoge1xuICAgICAgICBWZXJzaW9uOiAnMjAxMi0xMC0xNycsXG4gICAgICAgIFN0YXRlbWVudDogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgICAgICAgIFByaW5jaXBhbDoge1xuICAgICAgICAgICAgICBTZXJ2aWNlOiAnZWNzLXRhc2tzLmFtYXpvbmF3cy5jb20nLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIEFjdGlvbjogJ3N0czpBc3N1bWVSb2xlJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICAgIHBvbGljaWVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBwb2xpY3lOYW1lOiAnQXBwUnVudGltZUNvbmZpZ1JlYWQnLFxuICAgICAgICAgIHBvbGljeURvY3VtZW50OiB7XG4gICAgICAgICAgICBWZXJzaW9uOiAnMjAxMi0xMC0xNycsXG4gICAgICAgICAgICBTdGF0ZW1lbnQ6IFtcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgICAgICAgICAgICBBY3Rpb246IFsnc3NtOkdldFBhcmFtZXRlcicsICdzc206R2V0UGFyYW1ldGVycycsICdzc206R2V0UGFyYW1ldGVyc0J5UGF0aCcsICdrbXM6RGVjcnlwdCddLFxuICAgICAgICAgICAgICAgIFJlc291cmNlOiBbXG4gICAgICAgICAgICAgICAgICBgYXJuOmF3czpzc206JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnBhcmFtZXRlciR7c3NtUHJlZml4fSpgLFxuICAgICAgICAgICAgICAgICAgYGFybjphd3M6a21zOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTprZXkvKmAsXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG4gICAgdGFza1JvbGUuY2ZuT3B0aW9ucy5kZWxldGlvblBvbGljeSA9IGNkay5DZm5EZWxldGlvblBvbGljeS5ERUxFVEU7XG5cbiAgICBjb25zdCBhcHBUYXNrRGVmaW5pdGlvbiA9IG5ldyBlY3MuQ2ZuVGFza0RlZmluaXRpb24odGhpcywgJ0FwcFRhc2tEZWZpbml0aW9uJywge1xuICAgICAgZmFtaWx5OiAnbWFpbC1leGFtcGxlJyxcbiAgICAgIGNwdTogY29udGFpbmVyQ3B1LnRvU3RyaW5nKCksXG4gICAgICBtZW1vcnk6IGNvbnRhaW5lck1lbW9yeS50b1N0cmluZygpLFxuICAgICAgbmV0d29ya01vZGU6ICdhd3N2cGMnLFxuICAgICAgcmVxdWlyZXNDb21wYXRpYmlsaXRpZXM6IFsnRkFSR0FURSddLFxuICAgICAgZXhlY3V0aW9uUm9sZUFybjogdGFza0V4ZWN1dGlvblJvbGUuYXR0ckFybixcbiAgICAgIHRhc2tSb2xlQXJuOiB0YXNrUm9sZS5hdHRyQXJuLFxuICAgICAgY29udGFpbmVyRGVmaW5pdGlvbnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIG5hbWU6ICdtYWlsLWV4YW1wbGUnLFxuICAgICAgICAgIGltYWdlOiBgJHttYWlsRXhhbXBsZVJlcG9zaXRvcnkuYXR0clJlcG9zaXRvcnlVcml9OmxhdGVzdGAsXG4gICAgICAgICAgcG9ydE1hcHBpbmdzOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGNvbnRhaW5lclBvcnQsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgICAgbG9nQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgICAgbG9nRHJpdmVyOiAnYXdzbG9ncycsXG4gICAgICAgICAgICBvcHRpb25zOiB7XG4gICAgICAgICAgICAgICdhd3Nsb2dzLWdyb3VwJzogYXBwTG9nR3JvdXAucmVmLFxuICAgICAgICAgICAgICAnYXdzbG9ncy1yZWdpb24nOiB0aGlzLnJlZ2lvbixcbiAgICAgICAgICAgICAgJ2F3c2xvZ3Mtc3RyZWFtLXByZWZpeCc6ICdtYWlsLWV4YW1wbGUnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGVudmlyb25tZW50OiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG5hbWU6ICdDT05GSUdfU1NNX1BSRUZJWCcsXG4gICAgICAgICAgICAgIHZhbHVlOiBzc21QcmVmaXgsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBuYW1lOiAnUE9SVCcsXG4gICAgICAgICAgICAgIHZhbHVlOiBjb250YWluZXJQb3J0LnRvU3RyaW5nKCksXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBuYW1lOiAnQkFTRV9VUkwnLFxuICAgICAgICAgICAgICB2YWx1ZTogYmFzZVVybC50b1N0cmluZygpLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgbmFtZTogJ05PREVfRU5WJyxcbiAgICAgICAgICAgICAgdmFsdWU6IHB1YmxpY0VudlZhbHVlLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICAgIHNlY3JldHM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgbmFtZTogJ0dPT0dMRV9DTElFTlRfSUQnLFxuICAgICAgICAgICAgICB2YWx1ZUZyb206IGBhcm46YXdzOnNzbToke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06cGFyYW1ldGVyJHtzc21QcmVmaXh9L2Vudi9HT09HTEVfQ0xJRU5UX0lEYCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG5hbWU6ICdHT09HTEVfQ0xJRU5UX1NFQ1JFVCcsXG4gICAgICAgICAgICAgIHZhbHVlRnJvbTogYGFybjphd3M6c3NtOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpwYXJhbWV0ZXIke3NzbVByZWZpeH0vc2VjcmV0cy9HT09HTEVfQ0xJRU5UX1NFQ1JFVGAsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBuYW1lOiAnU0VTU0lPTl9TRUNSRVQnLFxuICAgICAgICAgICAgICB2YWx1ZUZyb206IGBhcm46YXdzOnNzbToke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06cGFyYW1ldGVyJHtzc21QcmVmaXh9L3NlY3JldHMvU0VTU0lPTl9TRUNSRVRgLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcbiAgICBhcHBUYXNrRGVmaW5pdGlvbi5jZm5PcHRpb25zLmRlbGV0aW9uUG9saWN5ID0gY2RrLkNmbkRlbGV0aW9uUG9saWN5LkRFTEVURTtcblxuICAgIG5ldyBlY3MuQ2ZuU2VydmljZSh0aGlzLCAnQXBwU2VydmljZScsIHtcbiAgICAgIHNlcnZpY2VOYW1lOiAnbWFpbC1leGFtcGxlJyxcbiAgICAgIGNsdXN0ZXI6IG1haWxDbHVzdGVyLnJlZixcbiAgICAgIHRhc2tEZWZpbml0aW9uOiBhcHBUYXNrRGVmaW5pdGlvbi5yZWYsXG4gICAgICBkZXNpcmVkQ291bnQsXG4gICAgICBjYXBhY2l0eVByb3ZpZGVyU3RyYXRlZ3k6IFtcbiAgICAgICAge1xuICAgICAgICAgIGNhcGFjaXR5UHJvdmlkZXI6ICdGQVJHQVRFX1NQT1QnLFxuICAgICAgICAgIHdlaWdodDogNCxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGNhcGFjaXR5UHJvdmlkZXI6ICdGQVJHQVRFJyxcbiAgICAgICAgICB3ZWlnaHQ6IDEsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgZGVwbG95bWVudENvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgbWF4aW11bVBlcmNlbnQ6IDIwMCxcbiAgICAgICAgbWluaW11bUhlYWx0aHlQZXJjZW50OiA1MCxcbiAgICAgIH0sXG4gICAgICBuZXR3b3JrQ29uZmlndXJhdGlvbjoge1xuICAgICAgICBhd3N2cGNDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgYXNzaWduUHVibGljSXA6ICdESVNBQkxFRCcsXG4gICAgICAgICAgc3VibmV0czogc2VydmljZVN1Ym5ldElkcyxcbiAgICAgICAgICBzZWN1cml0eUdyb3VwczogW3NlcnZpY2VTZWN1cml0eUdyb3VwLnJlZl0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgc2VydmljZVJlZ2lzdHJpZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHJlZ2lzdHJ5QXJuOiBhcHBDbG91ZE1hcFNlcnZpY2UuYXR0ckFybixcbiAgICAgICAgICBjb250YWluZXJOYW1lOiAnbWFpbC1leGFtcGxlJyxcbiAgICAgICAgICBjb250YWluZXJQb3J0OiBjb250YWluZXJQb3J0LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIHBsYXRmb3JtVmVyc2lvbjogJ0xBVEVTVCcsXG4gICAgfSk7XG5cbiAgICBjb25zdCBtYWlsSW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheXYyLkNmbkludGVncmF0aW9uKHRoaXMsICdNYWlsSW50ZWdyYXRpb24nLCB7XG4gICAgICBhcGlJZDogbWFpbEh0dHBBcGkucmVmLFxuICAgICAgaW50ZWdyYXRpb25UeXBlOiAnSFRUUF9QUk9YWScsXG4gICAgICBpbnRlZ3JhdGlvbk1ldGhvZDogJ0FOWScsXG4gICAgICBpbnRlZ3JhdGlvblVyaTogYXBwQ2xvdWRNYXBTZXJ2aWNlLmF0dHJBcm4sXG4gICAgICBjb25uZWN0aW9uVHlwZTogJ1ZQQ19MSU5LJyxcbiAgICAgIGNvbm5lY3Rpb25JZDogYXBpVnBjTGluay5yZWYsXG4gICAgICBwYXlsb2FkRm9ybWF0VmVyc2lvbjogJzEuMCcsXG4gICAgfSk7XG5cbiAgICBuZXcgYXBpZ2F0ZXdheXYyLkNmblJvdXRlKHRoaXMsICdHbWFpbFZpZXdlclJvdXRlJywge1xuICAgICAgYXBpSWQ6IG1haWxIdHRwQXBpLnJlZixcbiAgICAgIHJvdXRlS2V5OiAnQU5ZIC9nbWFpbC12aWV3ZXInLFxuICAgICAgdGFyZ2V0OiBgaW50ZWdyYXRpb25zLyR7bWFpbEludGVncmF0aW9uLnJlZn1gLFxuICAgIH0pO1xuXG4gICAgbmV3IGFwaWdhdGV3YXl2Mi5DZm5Sb3V0ZSh0aGlzLCAnR21haWxWaWV3ZXJQcm94eVJvdXRlJywge1xuICAgICAgYXBpSWQ6IG1haWxIdHRwQXBpLnJlZixcbiAgICAgIHJvdXRlS2V5OiAnQU5ZIC9nbWFpbC12aWV3ZXIve3Byb3h5K30nLFxuICAgICAgdGFyZ2V0OiBgaW50ZWdyYXRpb25zLyR7bWFpbEludGVncmF0aW9uLnJlZn1gLFxuICAgIH0pO1xuXG4gICAgY29uc3Qgc3NtQmFzZVVybCA9IG5ldyBzc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsICdTc21CYXNlVXJsJywge1xuICAgICAgcGFyYW1ldGVyTmFtZTogYCR7c3NtUHJlZml4fS9lbnYvQkFTRV9VUkxgLFxuICAgICAgc3RyaW5nVmFsdWU6IGJhc2VVcmwsXG4gICAgICB0eXBlOiBzc20uUGFyYW1ldGVyVHlwZS5TVFJJTkcsXG4gICAgfSk7XG4gICAgKHNzbUJhc2VVcmwubm9kZS5kZWZhdWx0Q2hpbGQgYXMgc3NtLkNmblBhcmFtZXRlcikuY2ZuT3B0aW9ucy5kZWxldGlvblBvbGljeSA9IGNkay5DZm5EZWxldGlvblBvbGljeS5ERUxFVEU7XG5cbiAgICBjb25zdCBzc21Hb29nbGVDbGllbnRJZCA9IG5ldyBzc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsICdTc21Hb29nbGVDbGllbnRJZCcsIHtcbiAgICAgIHBhcmFtZXRlck5hbWU6IGAke3NzbVByZWZpeH0vZW52L0dPT0dMRV9DTElFTlRfSURgLFxuICAgICAgc3RyaW5nVmFsdWU6IGdvb2dsZUNsaWVudElkLFxuICAgICAgdHlwZTogc3NtLlBhcmFtZXRlclR5cGUuU1RSSU5HLFxuICAgIH0pO1xuICAgIChzc21Hb29nbGVDbGllbnRJZC5ub2RlLmRlZmF1bHRDaGlsZCBhcyBzc20uQ2ZuUGFyYW1ldGVyKS5jZm5PcHRpb25zLmRlbGV0aW9uUG9saWN5ID0gY2RrLkNmbkRlbGV0aW9uUG9saWN5LkRFTEVURTtcblxuICAgIGNvbnN0IHNzbUdvb2dsZUNsaWVudFNlY3JldCA9IG5ldyBzc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsICdTc21Hb29nbGVDbGllbnRTZWNyZXQnLCB7XG4gICAgICBwYXJhbWV0ZXJOYW1lOiBgJHtzc21QcmVmaXh9L3NlY3JldHMvR09PR0xFX0NMSUVOVF9TRUNSRVRgLFxuICAgICAgc3RyaW5nVmFsdWU6IGdvb2dsZUNsaWVudFNlY3JldCxcbiAgICAgIHR5cGU6IHNzbS5QYXJhbWV0ZXJUeXBlLlNUUklORyxcbiAgICB9KTtcbiAgICAoc3NtR29vZ2xlQ2xpZW50U2VjcmV0Lm5vZGUuZGVmYXVsdENoaWxkIGFzIHNzbS5DZm5QYXJhbWV0ZXIpLmNmbk9wdGlvbnMuZGVsZXRpb25Qb2xpY3kgPSBjZGsuQ2ZuRGVsZXRpb25Qb2xpY3kuREVMRVRFO1xuXG4gICAgY29uc3Qgc3NtUG9ydCA9IG5ldyBzc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsICdTc21Qb3J0Jywge1xuICAgICAgcGFyYW1ldGVyTmFtZTogYCR7c3NtUHJlZml4fS9lbnYvUE9SVGAsXG4gICAgICBzdHJpbmdWYWx1ZTogY29udGFpbmVyUG9ydC50b1N0cmluZygpLFxuICAgICAgdHlwZTogc3NtLlBhcmFtZXRlclR5cGUuU1RSSU5HLFxuICAgIH0pO1xuICAgIChzc21Qb3J0Lm5vZGUuZGVmYXVsdENoaWxkIGFzIHNzbS5DZm5QYXJhbWV0ZXIpLmNmbk9wdGlvbnMuZGVsZXRpb25Qb2xpY3kgPSBjZGsuQ2ZuRGVsZXRpb25Qb2xpY3kuREVMRVRFO1xuXG4gICAgY29uc3Qgc3NtUHVibGljRW52ID0gbmV3IHNzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgJ1NzbVB1YmxpY0VudicsIHtcbiAgICAgIHBhcmFtZXRlck5hbWU6IGAke3NzbVByZWZpeH0vZW52L05PREVfRU5WYCxcbiAgICAgIHN0cmluZ1ZhbHVlOiBwdWJsaWNFbnZWYWx1ZSxcbiAgICAgIHR5cGU6IHNzbS5QYXJhbWV0ZXJUeXBlLlNUUklORyxcbiAgICB9KTtcbiAgICAoc3NtUHVibGljRW52Lm5vZGUuZGVmYXVsdENoaWxkIGFzIHNzbS5DZm5QYXJhbWV0ZXIpLmNmbk9wdGlvbnMuZGVsZXRpb25Qb2xpY3kgPSBjZGsuQ2ZuRGVsZXRpb25Qb2xpY3kuREVMRVRFO1xuXG4gICAgY29uc3Qgc3NtU2Vzc2lvblNlY3JldCA9IG5ldyBzc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsICdTc21TZXNzaW9uU2VjcmV0Jywge1xuICAgICAgcGFyYW1ldGVyTmFtZTogYCR7c3NtUHJlZml4fS9zZWNyZXRzL1NFU1NJT05fU0VDUkVUYCxcbiAgICAgIHN0cmluZ1ZhbHVlOiBzZXNzaW9uU2VjcmV0VmFsdWUsXG4gICAgICB0eXBlOiBzc20uUGFyYW1ldGVyVHlwZS5TVFJJTkcsXG4gICAgfSk7XG4gICAgKHNzbVNlc3Npb25TZWNyZXQubm9kZS5kZWZhdWx0Q2hpbGQgYXMgc3NtLkNmblBhcmFtZXRlcikuY2ZuT3B0aW9ucy5kZWxldGlvblBvbGljeSA9IGNkay5DZm5EZWxldGlvblBvbGljeS5ERUxFVEU7XG5cbiAgICBjb25zdCBjb2RlQnVpbGRSb2xlID0gbmV3IGlhbS5DZm5Sb2xlKHRoaXMsICdDb2RlQnVpbGRSb2xlJywge1xuICAgICAgYXNzdW1lUm9sZVBvbGljeURvY3VtZW50OiB7XG4gICAgICAgIFZlcnNpb246ICcyMDEyLTEwLTE3JyxcbiAgICAgICAgU3RhdGVtZW50OiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgRWZmZWN0OiAnQWxsb3cnLFxuICAgICAgICAgICAgUHJpbmNpcGFsOiB7XG4gICAgICAgICAgICAgIFNlcnZpY2U6ICdjb2RlYnVpbGQuYW1hem9uYXdzLmNvbScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgQWN0aW9uOiAnc3RzOkFzc3VtZVJvbGUnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgICAgcG9saWNpZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHBvbGljeU5hbWU6ICdCdWlsZExvZ3MnLFxuICAgICAgICAgIHBvbGljeURvY3VtZW50OiB7XG4gICAgICAgICAgICBWZXJzaW9uOiAnMjAxMi0xMC0xNycsXG4gICAgICAgICAgICBTdGF0ZW1lbnQ6IFtcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgICAgICAgICAgICBBY3Rpb246IFsnbG9nczpDcmVhdGVMb2dHcm91cCcsICdsb2dzOkNyZWF0ZUxvZ1N0cmVhbScsICdsb2dzOlB1dExvZ0V2ZW50cyddLFxuICAgICAgICAgICAgICAgIFJlc291cmNlOiAnKicsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBwb2xpY3lOYW1lOiAnRUNSUHVzaCcsXG4gICAgICAgICAgcG9saWN5RG9jdW1lbnQ6IHtcbiAgICAgICAgICAgIFZlcnNpb246ICcyMDEyLTEwLTE3JyxcbiAgICAgICAgICAgIFN0YXRlbWVudDogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgRWZmZWN0OiAnQWxsb3cnLFxuICAgICAgICAgICAgICAgIEFjdGlvbjogW1xuICAgICAgICAgICAgICAgICAgJ2VjcjpHZXRBdXRob3JpemF0aW9uVG9rZW4nLFxuICAgICAgICAgICAgICAgICAgJ2VjcjpCYXRjaENoZWNrTGF5ZXJBdmFpbGFiaWxpdHknLFxuICAgICAgICAgICAgICAgICAgJ2VjcjpDb21wbGV0ZUxheWVyVXBsb2FkJyxcbiAgICAgICAgICAgICAgICAgICdlY3I6QmF0Y2hHZXRJbWFnZScsXG4gICAgICAgICAgICAgICAgICAnZWNyOkRlc2NyaWJlUmVwb3NpdG9yaWVzJyxcbiAgICAgICAgICAgICAgICAgICdlY3I6SW5pdGlhdGVMYXllclVwbG9hZCcsXG4gICAgICAgICAgICAgICAgICAnZWNyOlB1dEltYWdlJyxcbiAgICAgICAgICAgICAgICAgICdlY3I6VXBsb2FkTGF5ZXJQYXJ0JyxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIFJlc291cmNlOiAnKicsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBwb2xpY3lOYW1lOiAnRUNTRGVwbG95JyxcbiAgICAgICAgICBwb2xpY3lEb2N1bWVudDoge1xuICAgICAgICAgICAgVmVyc2lvbjogJzIwMTItMTAtMTcnLFxuICAgICAgICAgICAgU3RhdGVtZW50OiBbXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBFZmZlY3Q6ICdBbGxvdycsXG4gICAgICAgICAgICAgICAgQWN0aW9uOiBbJ2VjczpVcGRhdGVTZXJ2aWNlJywgJ2VjczpEZXNjcmliZVNlcnZpY2VzJywgJ2VjczpEZXNjcmliZUNsdXN0ZXJzJ10sXG4gICAgICAgICAgICAgICAgUmVzb3VyY2U6ICcqJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHBvbGljeU5hbWU6ICdTU01SZWFkRm9yQnVpbGQnLFxuICAgICAgICAgIHBvbGljeURvY3VtZW50OiB7XG4gICAgICAgICAgICBWZXJzaW9uOiAnMjAxMi0xMC0xNycsXG4gICAgICAgICAgICBTdGF0ZW1lbnQ6IFtcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgICAgICAgICAgICBBY3Rpb246IFsnc3NtOkdldFBhcmFtZXRlcicsICdzc206R2V0UGFyYW1ldGVycycsICdzc206R2V0UGFyYW1ldGVyc0J5UGF0aCddLFxuICAgICAgICAgICAgICAgIFJlc291cmNlOiAnKicsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBwb2xpY3lOYW1lOiAnQ29kZUNvbm5lY3Rpb25BY2Nlc3MnLFxuICAgICAgICAgIHBvbGljeURvY3VtZW50OiB7XG4gICAgICAgICAgICBWZXJzaW9uOiAnMjAxMi0xMC0xNycsXG4gICAgICAgICAgICBTdGF0ZW1lbnQ6IFtcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgICAgICAgICAgICBBY3Rpb246IFtcbiAgICAgICAgICAgICAgICBcImNvZGVjb25uZWN0aW9uczpHZXRDb25uZWN0aW9uXCIsXG4gICAgICAgICAgICAgICAgXCJjb2RlY29ubmVjdGlvbnM6R2V0Q29ubmVjdGlvblRva2VuXCIsXG4gICAgICAgICAgICAgICAgXCJjb2RlY29ubmVjdGlvbnM6VXNlQ29ubmVjdGlvblwiXG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBSZXNvdXJjZTogcHJvcHMuY29kZUNvbm5lY3Rpb25Bcm4sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgIH1cbiAgICAgIF0sXG4gICAgfSk7XG4gICAgY29kZUJ1aWxkUm9sZS5jZm5PcHRpb25zLmRlbGV0aW9uUG9saWN5ID0gY2RrLkNmbkRlbGV0aW9uUG9saWN5LkRFTEVURTtcblxuICAgIC8vIFVzZSB0aGUgaGlnaGVyLWxldmVsIFByb2plY3QgY29uc3RydWN0IHNvIHdlIGNhbiBwcm92aWRlIGEgdHlwZWQgQnVpbGRTcGVjXG4gICAgY29uc3QgY29kZWJ1aWxkUm9sZVJlZiA9IGlhbS5Sb2xlLmZyb21Sb2xlQXJuKHRoaXMsICdDb2RlQnVpbGRSb2xlUmVmJywgY29kZUJ1aWxkUm9sZS5hdHRyQXJuKTtcblxuICAgIGNvbnN0IGNvZGVCdWlsZFByb2plY3QgPSBuZXcgY29kZWJ1aWxkLlByb2plY3QodGhpcywgJ0NvZGVCdWlsZFByb2plY3QnLCB7XG4gICAgICBwcm9qZWN0TmFtZTogJ21haWwtZXhhbXBsZScsXG4gICAgICByb2xlOiBjb2RlYnVpbGRSb2xlUmVmLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgYnVpbGRJbWFnZTogY29kZWJ1aWxkLkxpbnV4QnVpbGRJbWFnZS5TVEFOREFSRF83XzAsXG4gICAgICAgIGNvbXB1dGVUeXBlOiBjb2RlYnVpbGQuQ29tcHV0ZVR5cGUuU01BTEwsXG4gICAgICAgIHByaXZpbGVnZWQ6IHRydWUsXG4gICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzOiB7XG4gICAgICAgICAgRUNSX1VSSTogeyB2YWx1ZTogbWFpbEV4YW1wbGVSZXBvc2l0b3J5LmF0dHJSZXBvc2l0b3J5VXJpIH0sXG4gICAgICAgICAgQ0xVU1RFUl9OQU1FOiB7IHZhbHVlOiBtYWlsQ2x1c3Rlci5yZWYgfSxcbiAgICAgICAgICBTRVJWSUNFX05BTUU6IHsgdmFsdWU6ICdtYWlsLWV4YW1wbGUnIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgc291cmNlOiBjb2RlYnVpbGQuU291cmNlLmdpdEh1Yih7IG93bmVyOiBnaXRIdWJPd25lciwgcmVwbzogZ2l0SHViUmVwbywgYnJhbmNoT3JSZWY6IGdpdEh1YkJyYW5jaCwgfSksXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygzMCksXG4gICAgICBxdWV1ZWRUaW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygzMCksXG4gICAgICBiYWRnZTogdHJ1ZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQnVpbGQgJiBkZXBsb3kgbWFpbC1leGFtcGxlIHRvIEVDUiB0aGVuIGZvcmNlIEVDUyBkZXBsb3knLFxuICAgICAgY2FjaGU6IGNvZGVidWlsZC5DYWNoZS5ub25lKCksXG4gICAgICBidWlsZFNwZWM6IGNvZGVidWlsZC5CdWlsZFNwZWMuZnJvbU9iamVjdCh7XG4gICAgICAgIHZlcnNpb246ICcwLjInLFxuICAgICAgICBwaGFzZXM6IHtcbiAgICAgICAgICBwcmVfYnVpbGQ6IHsgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICdlY2hvIFwiTG9nZ2luZyBpbiB0byBFQ1JcIicsXG4gICAgICAgICAgICAnYXdzIGVjciBnZXQtbG9naW4tcGFzc3dvcmQgLS1yZWdpb24gJEFXU19ERUZBVUxUX1JFR0lPTiB8IGRvY2tlciBsb2dpbiAtLXVzZXJuYW1lIEFXUyAtLXBhc3N3b3JkLXN0ZGluICRFQ1JfVVJJJyxcbiAgICAgICAgICAgICdJTUFHRV9UQUc9JHtDT0RFQlVJTERfUkVTT0xWRURfU09VUkNFX1ZFUlNJT046LWxhdGVzdH0nLFxuICAgICAgICAgIF19LFxuICAgICAgICAgIGJ1aWxkOiB7IGNvbW1hbmRzOiBbXG4gICAgICAgICAgICAnY2QgZXhhbXBsZXMvZ21haWwtdmlld2VyJyxcbiAgICAgICAgICAgICdkb2NrZXIgYnVpbGQgLXQgJEVDUl9VUkk6bGF0ZXN0IC10ICRFQ1JfVVJJOiRJTUFHRV9UQUcgLicsXG4gICAgICAgICAgXSB9LFxuICAgICAgICAgIHBvc3RfYnVpbGQ6IHsgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICdkb2NrZXIgcHVzaCAkRUNSX1VSSTpsYXRlc3QnLFxuICAgICAgICAgICAgJ2RvY2tlciBwdXNoICRFQ1JfVVJJOiRJTUFHRV9UQUcnLFxuICAgICAgICAgICAgJ2F3cyBlY3MgdXBkYXRlLXNlcnZpY2UgLS1jbHVzdGVyICRDTFVTVEVSX05BTUUgLS1zZXJ2aWNlICRTRVJWSUNFX05BTUUgLS1mb3JjZS1uZXctZGVwbG95bWVudCcsXG4gICAgICAgICAgXX0sXG4gICAgICAgIH0sXG4gICAgICAgIGFydGlmYWN0czogeyBmaWxlczogW10gfSxcbiAgICAgICAgZW52OiB7IHNoZWxsOiAnYmFzaCcgfSxcbiAgICAgIH0pLFxuICAgIH0pO1xuICAgIChjb2RlQnVpbGRQcm9qZWN0Lm5vZGUuZGVmYXVsdENoaWxkIGFzIGNvZGVidWlsZC5DZm5Qcm9qZWN0KS5jZm5PcHRpb25zLmRlbGV0aW9uUG9saWN5ID0gY2RrLkNmbkRlbGV0aW9uUG9saWN5LkRFTEVURTtcblxuICAgIHRoaXMuY2x1c3Rlck5hbWUgPSBtYWlsQ2x1c3Rlci5yZWY7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Nmbk91dHB1dENsdXN0ZXJOYW1lJywge1xuICAgICAga2V5OiAnQ2x1c3Rlck5hbWUnLFxuICAgICAgdmFsdWU6IHRoaXMuY2x1c3Rlck5hbWUudG9TdHJpbmcoKSxcbiAgICB9KTtcbiAgICB0aGlzLnJlcG9zaXRvcnlVcmkgPSBtYWlsRXhhbXBsZVJlcG9zaXRvcnkuYXR0clJlcG9zaXRvcnlVcmk7XG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Nmbk91dHB1dFJlcG9zaXRvcnlVcmknLCB7XG4gICAgICBrZXk6ICdSZXBvc2l0b3J5VXJpJyxcbiAgICAgIHZhbHVlOiB0aGlzLnJlcG9zaXRvcnlVcmkudG9TdHJpbmcoKSxcbiAgICB9KTtcbiAgICB0aGlzLmFwaUludm9rZVVybCA9IGJhc2VVcmwudG9TdHJpbmcoKTtcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ2ZuT3V0cHV0QXBpSW52b2tlVXJsJywge1xuICAgICAga2V5OiAnQXBpSW52b2tlVXJsJyxcbiAgICAgIHZhbHVlOiB0aGlzLmFwaUludm9rZVVybCxcbiAgICB9KTtcbiAgICB0aGlzLmNsb3VkTWFwU2VydmljZUFybiA9IGFwcENsb3VkTWFwU2VydmljZS5hdHRyQXJuO1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDZm5PdXRwdXRDbG91ZE1hcFNlcnZpY2VBcm4nLCB7XG4gICAgICBrZXk6ICdDbG91ZE1hcFNlcnZpY2VBcm4nLFxuICAgICAgdmFsdWU6IHRoaXMuY2xvdWRNYXBTZXJ2aWNlQXJuLnRvU3RyaW5nKCksXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==