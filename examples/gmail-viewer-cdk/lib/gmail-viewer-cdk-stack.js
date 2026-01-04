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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZ21haWwtdmlld2VyLWNkay1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImdtYWlsLXZpZXdlci1jZGstc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLDJFQUE2RDtBQUM3RCxxRUFBdUQ7QUFDdkQseURBQTJDO0FBQzNDLHlEQUEyQztBQUMzQyx5REFBMkM7QUFDM0MseURBQTJDO0FBQzNDLDJEQUE2QztBQUM3QyxpRUFBbUQ7QUFDbkQsbUZBQXFFO0FBQ3JFLHlEQUEyQztBQTBCM0MsTUFBYSxtQkFBb0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUNoQyxXQUFXLENBQVM7SUFDcEIsYUFBYSxDQUFTO0lBQ3RCLFlBQVksQ0FBUztJQUNyQixrQkFBa0IsQ0FBUztJQUUzQyxZQUFtQixLQUFjLEVBQUUsRUFBVSxFQUFFLEtBQStCO1FBQzVFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sUUFBUSxHQUFHLENBQUMsS0FBa0MsRUFBRSxRQUFnQixFQUFVLEVBQUU7WUFDaEYsTUFBTSxTQUFTLEdBQUcsS0FBSyxJQUFJLFFBQVEsQ0FBQztZQUNwQyxNQUFNLE1BQU0sR0FBRyxPQUFPLFNBQVMsS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1lBQzdFLE9BQU8sTUFBTSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUM7UUFDckQsQ0FBQyxDQUFDO1FBRUYsTUFBTSxVQUFVLEdBQUcsQ0FBQyxLQUFrQyxFQUFVLEVBQUU7WUFDaEUsTUFBTSxNQUFNLEdBQUcsUUFBUSxDQUFDLEtBQUssRUFBRSxHQUFHLENBQUMsQ0FBQztZQUNwQyxN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QUksRUFBRSw2QkFBNkIsRUFBRTtZQUNyRCxHQUFHLEVBQUUsb0JBQW9CO1lBQ3pCLEtBQUssRUFBRSxJQUFJLENBQUMsa0JBQWtCLENBQUMsUUFBUSxFQUFFO1NBQzFDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQXpwQkQsa0RBeXBCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XHJcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXl2MiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheXYyJztcclxuaW1wb3J0ICogYXMgY29kZWJ1aWxkIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2RlYnVpbGQnO1xyXG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XHJcbmltcG9ydCAqIGFzIGVjciBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNyJztcclxuaW1wb3J0ICogYXMgZWNzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3MnO1xyXG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XHJcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xyXG5pbXBvcnQgKiBhcyByb3V0ZTUzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1yb3V0ZTUzJztcclxuaW1wb3J0ICogYXMgc2VydmljZWRpc2NvdmVyeSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VydmljZWRpc2NvdmVyeSc7XHJcbmltcG9ydCAqIGFzIHNzbSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3NtJztcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgR21haWxWaWV3ZXJDZGtTdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xyXG4gIHJlYWRvbmx5IHZwY0lkPzogc3RyaW5nO1xyXG4gIHJlYWRvbmx5IHByaXZhdGVTdWJuZXRzPzogc3RyaW5nW107XHJcbiAgcmVhZG9ubHkgY29udGFpbmVyUG9ydD86IG51bWJlciB8IHN0cmluZztcclxuICByZWFkb25seSBjb250YWluZXJDcHU/OiBudW1iZXIgfCBzdHJpbmc7XHJcbiAgcmVhZG9ubHkgY29udGFpbmVyTWVtb3J5PzogbnVtYmVyIHwgc3RyaW5nO1xyXG4gIHJlYWRvbmx5IGRlc2lyZWRDb3VudD86IG51bWJlciB8IHN0cmluZztcclxuICByZWFkb25seSBjZXJ0aWZpY2F0ZUFybj86IHN0cmluZztcclxuICByZWFkb25seSBhcGlDdXN0b21Eb21haW5OYW1lPzogc3RyaW5nO1xyXG4gIHJlYWRvbmx5IGhvc3RlZFpvbmVJZD86IHN0cmluZztcclxuICByZWFkb25seSBzZXJ2aWNlRGlzY292ZXJ5TmFtZXNwYWNlTmFtZT86IHN0cmluZztcclxuICByZWFkb25seSBzZXJ2aWNlRGlzY292ZXJ5VHRsPzogbnVtYmVyIHwgc3RyaW5nO1xyXG4gIHJlYWRvbmx5IHNzbVByZWZpeD86IHN0cmluZztcclxuICByZWFkb25seSBnaXRIdWJPd25lcj86IHN0cmluZztcclxuICByZWFkb25seSBnaXRIdWJSZXBvPzogc3RyaW5nO1xyXG4gIHJlYWRvbmx5IGdpdEh1YkJyYW5jaD86IHN0cmluZztcclxuICByZWFkb25seSBwdWJsaWNFbnZWYWx1ZT86IHN0cmluZztcclxuICByZWFkb25seSBnb29nbGVDbGllbnRJZD86IHN0cmluZztcclxuICByZWFkb25seSBnb29nbGVDbGllbnRTZWNyZXQ/OiBzdHJpbmc7XHJcbiAgcmVhZG9ubHkgc2Vzc2lvblNlY3JldFZhbHVlPzogc3RyaW5nO1xyXG4gIHJlYWRvbmx5IHVzZUdpdEh1YldlYmhvb2tzPzogYm9vbGVhbjtcclxuICByZWFkb25seSBjb2RlQ29ubmVjdGlvbkFybj86IHN0cmluZztcclxufVxyXG5cclxuZXhwb3J0IGNsYXNzIEdtYWlsVmlld2VyQ2RrU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xyXG4gIHB1YmxpYyByZWFkb25seSBjbHVzdGVyTmFtZTogc3RyaW5nO1xyXG4gIHB1YmxpYyByZWFkb25seSByZXBvc2l0b3J5VXJpOiBzdHJpbmc7XHJcbiAgcHVibGljIHJlYWRvbmx5IGFwaUludm9rZVVybDogc3RyaW5nO1xyXG4gIHB1YmxpYyByZWFkb25seSBjbG91ZE1hcFNlcnZpY2VBcm46IHN0cmluZztcclxuXHJcbiAgcHVibGljIGNvbnN0cnVjdG9yKHNjb3BlOiBjZGsuQXBwLCBpZDogc3RyaW5nLCBwcm9wczogR21haWxWaWV3ZXJDZGtTdGFja1Byb3BzKSB7XHJcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcclxuXHJcbiAgICBjb25zdCB0b051bWJlciA9ICh2YWx1ZTogc3RyaW5nIHwgbnVtYmVyIHwgdW5kZWZpbmVkLCBmYWxsYmFjazogbnVtYmVyKTogbnVtYmVyID0+IHtcclxuICAgICAgY29uc3QgY2FuZGlkYXRlID0gdmFsdWUgPz8gZmFsbGJhY2s7XHJcbiAgICAgIGNvbnN0IHBhcnNlZCA9IHR5cGVvZiBjYW5kaWRhdGUgPT09ICdudW1iZXInID8gY2FuZGlkYXRlIDogTnVtYmVyKGNhbmRpZGF0ZSk7XHJcbiAgICAgIHJldHVybiBOdW1iZXIuaXNGaW5pdGUocGFyc2VkKSA/IHBhcnNlZCA6IGZhbGxiYWNrO1xyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCB0b0NwdVVuaXRzID0gKHZhbHVlOiBzdHJpbmcgfCBudW1iZXIgfCB1bmRlZmluZWQpOiBudW1iZXIgPT4ge1xyXG4gICAgICBjb25zdCBwYXJzZWQgPSB0b051bWJlcih2YWx1ZSwgMC41KTtcclxuICAgICAgY29uc3QgdmNwdSA9IHBhcnNlZCA8PSA0ID8gcGFyc2VkICogMTAyNCA6IHBhcnNlZDtcclxuICAgICAgY29uc3Qgcm91bmRlZCA9IE1hdGgucm91bmQodmNwdSAvIDI1NikgKiAyNTY7XHJcbiAgICAgIHJldHVybiBNYXRoLm1heCgyNTYsIHJvdW5kZWQpO1xyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCByZXBvUGFydHMgPSAocHJvY2Vzcy5lbnYuR0lUSFVCX1JFUE9TSVRPUlkgPz8gJycpLnNwbGl0KCcvJyk7XHJcbiAgICBjb25zdCBndWVzc2VkR2l0SHViT3duZXIgPSByZXBvUGFydHNbMF0gfHwgJ2R5YW5ldCc7XHJcbiAgICBjb25zdCBndWVzc2VkR2l0SHViUmVwbyA9IHJlcG9QYXJ0c1sxXSB8fCAnaW1hcCc7XHJcblxyXG4gICAgY29uc3QgY29udGFpbmVyUG9ydCA9IHRvTnVtYmVyKHByb3BzLmNvbnRhaW5lclBvcnQsIDMwMDApO1xyXG4gICAgY29uc3QgY29udGFpbmVyQ3B1ID0gdG9DcHVVbml0cyhwcm9wcy5jb250YWluZXJDcHUpO1xyXG4gICAgY29uc3QgY29udGFpbmVyTWVtb3J5ID0gdG9OdW1iZXIocHJvcHMuY29udGFpbmVyTWVtb3J5LCAxMDI0KTtcclxuICAgIGNvbnN0IGRlc2lyZWRDb3VudCA9IHRvTnVtYmVyKHByb3BzLmRlc2lyZWRDb3VudCwgMSk7XHJcbiAgICBjb25zdCBzZXJ2aWNlRGlzY292ZXJ5TmFtZXNwYWNlTmFtZSA9IHByb3BzLnNlcnZpY2VEaXNjb3ZlcnlOYW1lc3BhY2VOYW1lID8/ICdtYWlsLmxvY2FsJztcclxuICAgIGNvbnN0IHNlcnZpY2VEaXNjb3ZlcnlUdGwgPSB0b051bWJlcihwcm9wcy5zZXJ2aWNlRGlzY292ZXJ5VHRsLCA2MCk7XHJcbiAgICBjb25zdCBzc21QcmVmaXhSYXcgPSBwcm9wcy5zc21QcmVmaXggPz8gJy9tYWlsLWV4YW1wbGUnO1xyXG4gICAgY29uc3Qgc3NtUHJlZml4ID0gJy8nICsgc3NtUHJlZml4UmF3LnNwbGl0KCcvJykuZmlsdGVyKHAgPT4gcCkuam9pbignLycpO1xyXG4gICAgY29uc3QgZ2l0SHViT3duZXIgPSBwcm9wcy5naXRIdWJPd25lciA/PyBndWVzc2VkR2l0SHViT3duZXI7XHJcbiAgICBjb25zdCBnaXRIdWJSZXBvID0gcHJvcHMuZ2l0SHViUmVwbyA/PyBndWVzc2VkR2l0SHViUmVwbztcclxuICAgIGNvbnN0IGdpdEh1YkJyYW5jaCA9IHByb3BzLmdpdEh1YkJyYW5jaCA/PyBwcm9jZXNzLmVudi5HSVRIVUJfUkVGX05BTUUgPz8gJ21haW4nO1xyXG4gICAgY29uc3QgcHVibGljRW52VmFsdWUgPSBwcm9wcy5wdWJsaWNFbnZWYWx1ZSA/PyAncHJvZHVjdGlvbic7XHJcbiAgICBjb25zdCBnb29nbGVDbGllbnRJZCA9IHByb3BzLmdvb2dsZUNsaWVudElkIHx8ICdub3Qtc2V0JztcclxuICAgIGNvbnN0IGdvb2dsZUNsaWVudFNlY3JldCA9IHByb3BzLmdvb2dsZUNsaWVudFNlY3JldCA/PyAnbm90LXNldCc7XHJcbiAgICBjb25zdCBzZXNzaW9uU2VjcmV0VmFsdWUgPSBwcm9wcy5zZXNzaW9uU2VjcmV0VmFsdWUgPz8gJ25vdC1zZXQnO1xyXG4gICAgY29uc3QgYXBpQ3VzdG9tRG9tYWluTmFtZSA9IHByb3BzLmFwaUN1c3RvbURvbWFpbk5hbWUgPz8gcHJvY2Vzcy5lbnYuQVBJX0NVU1RPTV9ET01BSU4gPz8gJ21haWwuZHlhbmV0LmNvbSc7XHJcbiAgICBjb25zdCBjZXJ0aWZpY2F0ZUFybiA9IHByb3BzLmNlcnRpZmljYXRlQXJuID8/IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdjZXJ0aWZpY2F0ZUFybicpID8/IHByb2Nlc3MuZW52LkNFUlRJRklDQVRFX0FSTjtcclxuICAgIGNvbnN0IGhvc3RlZFpvbmVJZCA9IHByb3BzLmhvc3RlZFpvbmVJZCA/PyAnJztcclxuICAgIGNvbnN0IGhhc0N1c3RvbURvbWFpbiA9IEJvb2xlYW4oY2VydGlmaWNhdGVBcm4gJiYgYXBpQ3VzdG9tRG9tYWluTmFtZSk7XHJcbiAgICBjb25zdCBoYXNIb3N0ZWRab25lID0gQm9vbGVhbihob3N0ZWRab25lSWQpO1xyXG5cclxuICAgIGxldCB2cGM6IGVjMi5JVnBjO1xyXG4gICAgbGV0IHByaXZhdGVTdWJuZXRJZHM6IHN0cmluZ1tdO1xyXG4gICAgbGV0IHNlcnZpY2VTdWJuZXRJZHM6IHN0cmluZ1tdO1xyXG5cclxuICAgIC8vIElmIGFjY291bnQvcmVnaW9uIGFyZSBhdmFpbGFibGUsIHVzZSBWcGMuZnJvbUxvb2t1cCB0byBhdXRvbWF0aWNhbGx5IGRpc2NvdmVyIHN1Ym5ldHMuXHJcbiAgICAvLyBPdGhlcndpc2UgZmFsbCBiYWNrIHRvIENsb3VkRm9ybWF0aW9uIHBhcmFtZXRlcnMgd2hpY2ggbGV0IHRoZSBkZXBsb3llciBwaWNrIHZhbHVlcyBpbiB0aGUgY29uc29sZS5cclxuICAgIGNvbnN0IHVzZVZwY1BhcmFtZXRlciA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCd1c2VWcGNQYXJhbWV0ZXInKTtcclxuXHJcbiAgICBpZiAoIXVzZVZwY1BhcmFtZXRlciAmJiB0aGlzLmFjY291bnQgJiYgdGhpcy5yZWdpb24pIHtcclxuICAgICAgdnBjID0gZWMyLlZwYy5mcm9tTG9va3VwKHRoaXMsICdNYWlsVnBjJywgeyB0YWdzOiB7IE5hbWU6ICdkeWEtdnBjJyB9IH0pO1xyXG4gICAgICBcclxuICAgICAgaWYgKHByb3BzLnByaXZhdGVTdWJuZXRzICYmIHByb3BzLnByaXZhdGVTdWJuZXRzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgIHByaXZhdGVTdWJuZXRJZHMgPSBwcm9wcy5wcml2YXRlU3VibmV0cztcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIC8vIFRoZSBzZXJ2aWNlIGxpbmtlZCB0byB0aGUgVlBDIExpbmsgbWF5IG5vdCBiZSBhdmFpbGFibGUgaW4gYWxsIEF2YWlsYWJpbGl0eSBab25lcy5cclxuICAgICAgICAgIGNvbnN0IGJhZEF6ID0gJ2NhYzEtYXo0JztcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgbGV0IHN1Ym5ldHMgPSB2cGMucHJpdmF0ZVN1Ym5ldHMuZmlsdGVyKHMgPT4gcy5hdmFpbGFiaWxpdHlab25lICE9PSBiYWRBeik7XHJcbiAgICAgICAgICBpZiAoc3VibmV0cy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgLy8gTm8gcHJpdmF0ZSBzdWJuZXRzLCB0cnkgcHVibGljIHN1Ym5ldHNcclxuICAgICAgICAgICAgc3VibmV0cyA9IHZwYy5wdWJsaWNTdWJuZXRzLmZpbHRlcihzID0+IHMuYXZhaWxhYmlsaXR5Wm9uZSAhPT0gYmFkQXopO1xyXG4gICAgICAgICAgfVxyXG5cclxuICAgICAgICAgIHByaXZhdGVTdWJuZXRJZHMgPSBzdWJuZXRzLnNsaWNlKDAsIDIpLm1hcChzID0+IHMuc3VibmV0SWQpO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBpZiAocHJpdmF0ZVN1Ym5ldElkcy5sZW5ndGggPCAxKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVlBDICcke3ZwYy52cGNJZH0nIG11c3QgaGF2ZSBhdCBsZWFzdCBvbmUgcHJpdmF0ZSBvciBwdWJsaWMgc3VibmV0IGluIGFuIGFsbG93ZWQgYXZhaWxhYmlsaXR5IHpvbmUgKG5vdCBpbiAke2JhZEF6fSkuYCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgc2VydmljZVN1Ym5ldElkcyA9IHByaXZhdGVTdWJuZXRJZHM7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAvLyBDbG91ZEZvcm1hdGlvbiBwYXJhbWV0ZXIgZm9yIFZQQyBzZWxlY3Rpb24gKGRyb3Bkb3duIG9mIFZQQyBJRHMgaW4gdGhlIGNvbnNvbGUpXHJcbiAgICAgIGNvbnN0IHZwY0lkUGFyYW0gPSBuZXcgY2RrLkNmblBhcmFtZXRlcih0aGlzLCAnVnBjSWRQYXJhbScsIHtcclxuICAgICAgICB0eXBlOiAnQVdTOjpFQzI6OlZQQzo6SWQnLFxyXG4gICAgICAgIGRlZmF1bHQ6IHByb3BzLnZwY0lkID8/ICcnLFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIE9wdGlvbmFsIHBhcmFtZXRlciBmb3IgcHJpdmF0ZSBzdWJuZXQgSURzIChDb21tYURlbGltaXRlZExpc3QpIHdoZW4gc3ludGhlc2l6aW5nIHdpdGhvdXQgYWNjb3VudC9yZWdpb25cclxuICAgICAgY29uc3QgcHJpdmF0ZVN1Ym5ldElkc1BhcmFtID0gbmV3IGNkay5DZm5QYXJhbWV0ZXIodGhpcywgJ1ByaXZhdGVTdWJuZXRJZHNQYXJhbScsIHtcclxuICAgICAgICB0eXBlOiAnQ29tbWFEZWxpbWl0ZWRMaXN0JyxcclxuICAgICAgICBkZWZhdWx0OiBwcm9wcy5wcml2YXRlU3VibmV0cyAmJiBwcm9wcy5wcml2YXRlU3VibmV0cy5sZW5ndGggPiAwID8gcHJvcHMucHJpdmF0ZVN1Ym5ldHMuam9pbignLCcpIDogJycsXHJcbiAgICAgIH0pO1xyXG4gICAgICAvLyBVc2UgdGhlIHByb3ZpZGVkIHBhcmFtZXRlciB2YWx1ZXMgKGRlcGxveWVyIG11c3Qgc3VwcGx5IHByaXZhdGUgc3VibmV0IGlkcyB3aGVuIHN5bnRoZXNpemluZyB3aXRob3V0IGxvb2t1cClcclxuICAgICAgdnBjID0gZWMyLlZwYy5mcm9tVnBjQXR0cmlidXRlcyh0aGlzLCAnTWFpbFZwYycsIHtcclxuICAgICAgICB2cGNJZDogdnBjSWRQYXJhbS52YWx1ZUFzU3RyaW5nLFxyXG4gICAgICAgIGF2YWlsYWJpbGl0eVpvbmVzOiBjZGsuRm4uZ2V0QXpzKCksXHJcbiAgICAgICAgcHJpdmF0ZVN1Ym5ldElkczogcHJpdmF0ZVN1Ym5ldElkc1BhcmFtLnZhbHVlQXNMaXN0LFxyXG4gICAgICB9KTtcclxuICAgICAgcHJpdmF0ZVN1Ym5ldElkcyA9IHByb3BzLnByaXZhdGVTdWJuZXRzID8/IHByaXZhdGVTdWJuZXRJZHNQYXJhbS52YWx1ZUFzTGlzdDtcclxuICAgICAgc2VydmljZVN1Ym5ldElkcyA9IHByaXZhdGVTdWJuZXRJZHM7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgYXBpVnBjTGlua1NlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLkNmblNlY3VyaXR5R3JvdXAodGhpcywgJ0FwaVZwY0xpbmtTZWN1cml0eUdyb3VwJywge1xyXG4gICAgICBncm91cERlc2NyaXB0aW9uOiAnRWdyZXNzIGZyb20gQVBJIEdhdGV3YXkgVlBDIExpbmsgdG8gc2VydmljZScsXHJcbiAgICAgIHZwY0lkOiB2cGMudnBjSWQsXHJcbiAgICAgIHNlY3VyaXR5R3JvdXBFZ3Jlc3M6IFtcclxuICAgICAgICB7XHJcbiAgICAgICAgICBpcFByb3RvY29sOiAndGNwJyxcclxuICAgICAgICAgIGZyb21Qb3J0OiBjb250YWluZXJQb3J0LFxyXG4gICAgICAgICAgdG9Qb3J0OiBjb250YWluZXJQb3J0LFxyXG4gICAgICAgICAgY2lkcklwOiAnMC4wLjAuMC8wJyxcclxuICAgICAgICB9LFxyXG4gICAgICBdLFxyXG4gICAgfSk7XHJcbiAgICBhcGlWcGNMaW5rU2VjdXJpdHlHcm91cC5jZm5PcHRpb25zLmRlbGV0aW9uUG9saWN5ID0gY2RrLkNmbkRlbGV0aW9uUG9saWN5LkRFTEVURTtcclxuXHJcbiAgICBjb25zdCBzZXJ2aWNlU2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuQ2ZuU2VjdXJpdHlHcm91cCh0aGlzLCAnU2VydmljZVNlY3VyaXR5R3JvdXAnLCB7XHJcbiAgICAgIGdyb3VwRGVzY3JpcHRpb246ICdBbGxvdyBBUEkgR2F0ZXdheSBWUEMgTGluayB0byByZWFjaCBGYXJnYXRlIHRhc2tzJyxcclxuICAgICAgdnBjSWQ6IHZwYy52cGNJZCxcclxuICAgICAgc2VjdXJpdHlHcm91cEluZ3Jlc3M6IFtcclxuICAgICAgICB7XHJcbiAgICAgICAgICBpcFByb3RvY29sOiAndGNwJyxcclxuICAgICAgICAgIGZyb21Qb3J0OiBjb250YWluZXJQb3J0LFxyXG4gICAgICAgICAgdG9Qb3J0OiBjb250YWluZXJQb3J0LFxyXG4gICAgICAgICAgY2lkcklwOiAnMC4wLjAuMC8wJyxcclxuICAgICAgICB9LFxyXG4gICAgICBdLFxyXG4gICAgICBzZWN1cml0eUdyb3VwRWdyZXNzOiBbXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgaXBQcm90b2NvbDogJy0xJyxcclxuICAgICAgICAgIGZyb21Qb3J0OiAwLFxyXG4gICAgICAgICAgdG9Qb3J0OiA2NTUzNSxcclxuICAgICAgICAgIGNpZHJJcDogJzAuMC4wLjAvMCcsXHJcbiAgICAgICAgfSxcclxuICAgICAgXSxcclxuICAgIH0pO1xyXG4gICAgc2VydmljZVNlY3VyaXR5R3JvdXAuY2ZuT3B0aW9ucy5kZWxldGlvblBvbGljeSA9IGNkay5DZm5EZWxldGlvblBvbGljeS5ERUxFVEU7XHJcblxyXG4gICAgY29uc3QgYXBwTG9nR3JvdXAgPSBuZXcgbG9ncy5DZm5Mb2dHcm91cCh0aGlzLCAnQXBwTG9nR3JvdXAnLCB7XHJcbiAgICAgIGxvZ0dyb3VwTmFtZTogJy9lY3MvbWFpbC1leGFtcGxlJyxcclxuICAgICAgcmV0ZW50aW9uSW5EYXlzOiAzMCxcclxuICAgIH0pO1xyXG4gICAgYXBwTG9nR3JvdXAuY2ZuT3B0aW9ucy5kZWxldGlvblBvbGljeSA9IGNkay5DZm5EZWxldGlvblBvbGljeS5ERUxFVEU7XHJcblxyXG4gICAgY29uc3QgbWFpbENsdXN0ZXIgPSBuZXcgZWNzLkNmbkNsdXN0ZXIodGhpcywgJ01haWxDbHVzdGVyJywge1xyXG4gICAgICBjbHVzdGVyTmFtZTogJ21haWwtY2x1c3RlcicsXHJcbiAgICAgIGNhcGFjaXR5UHJvdmlkZXJzOiBbJ0ZBUkdBVEUnLCAnRkFSR0FURV9TUE9UJ10sXHJcbiAgICAgIGRlZmF1bHRDYXBhY2l0eVByb3ZpZGVyU3RyYXRlZ3k6IFtcclxuICAgICAgICB7XHJcbiAgICAgICAgICBjYXBhY2l0eVByb3ZpZGVyOiAnRkFSR0FURV9TUE9UJyxcclxuICAgICAgICAgIHdlaWdodDogNCxcclxuICAgICAgICB9LFxyXG4gICAgICAgIHtcclxuICAgICAgICAgIGNhcGFjaXR5UHJvdmlkZXI6ICdGQVJHQVRFJyxcclxuICAgICAgICAgIHdlaWdodDogMSxcclxuICAgICAgICB9LFxyXG4gICAgICBdLFxyXG4gICAgfSk7XHJcbiAgICBtYWlsQ2x1c3Rlci5jZm5PcHRpb25zLmRlbGV0aW9uUG9saWN5ID0gY2RrLkNmbkRlbGV0aW9uUG9saWN5LkRFTEVURTtcclxuXHJcbiAgICBjb25zdCBtYWlsRXhhbXBsZVJlcG9zaXRvcnkgPSBuZXcgZWNyLkNmblJlcG9zaXRvcnkodGhpcywgJ01haWxFeGFtcGxlUmVwb3NpdG9yeScsIHtcclxuICAgICAgcmVwb3NpdG9yeU5hbWU6ICdtYWlsLWV4YW1wbGUnLFxyXG4gICAgICBpbWFnZVRhZ011dGFiaWxpdHk6ICdNVVRBQkxFJyxcclxuICAgICAgZW5jcnlwdGlvbkNvbmZpZ3VyYXRpb246IHtcclxuICAgICAgICBlbmNyeXB0aW9uVHlwZTogJ0FFUzI1NicsXHJcbiAgICAgIH0sXHJcbiAgICAgIGxpZmVjeWNsZVBvbGljeToge1xyXG4gICAgICAgIGxpZmVjeWNsZVBvbGljeVRleHQ6XHJcbiAgICAgICAgICAne1xcbiAgXCJydWxlc1wiOiBbXFxuICAgIHtcXG4gICAgICBcInJ1bGVQcmlvcml0eVwiOiAxLFxcbiAgICAgIFwiZGVzY3JpcHRpb25cIjogXCJFeHBpcmUgaW1hZ2VzIG9sZGVyIHRoYW4gMzAgZGF5c1wiLFxcbiAgICAgIFwic2VsZWN0aW9uXCI6IHtcXG4gICAgICAgIFwidGFnU3RhdHVzXCI6IFwiYW55XCIsXFxuICAgICAgICBcImNvdW50VHlwZVwiOiBcInNpbmNlSW1hZ2VQdXNoZWRcIixcXG4gICAgICAgIFwiY291bnRVbml0XCI6IFwiZGF5c1wiLFxcbiAgICAgICAgXCJjb3VudE51bWJlclwiOiAzMFxcbiAgICAgIH0sXFxuICAgICAgXCJhY3Rpb25cIjogeyBcInR5cGVcIjogXCJleHBpcmVcIiB9XFxuICAgIH1cXG4gIF1cXG59XFxuJyxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gICAgbWFpbEV4YW1wbGVSZXBvc2l0b3J5LmNmbk9wdGlvbnMuZGVsZXRpb25Qb2xpY3kgPSBjZGsuQ2ZuRGVsZXRpb25Qb2xpY3kuREVMRVRFO1xyXG5cclxuICAgIGNvbnN0IG1haWxIdHRwQXBpID0gbmV3IGFwaWdhdGV3YXl2Mi5DZm5BcGkodGhpcywgJ01haWxIdHRwQXBpJywge1xyXG4gICAgICBuYW1lOiAnbWFpbC1leGFtcGxlJyxcclxuICAgICAgcHJvdG9jb2xUeXBlOiAnSFRUUCcsXHJcbiAgICB9KTtcclxuICAgIG1haWxIdHRwQXBpLmNmbk9wdGlvbnMuZGVsZXRpb25Qb2xpY3kgPSBjZGsuQ2ZuRGVsZXRpb25Qb2xpY3kuREVMRVRFO1xyXG5cclxuICAgIGNvbnN0IG1haWxBcGlTdGFnZSA9IG5ldyBhcGlnYXRld2F5djIuQ2ZuU3RhZ2UodGhpcywgJ01haWxBcGlTdGFnZScsIHtcclxuICAgICAgc3RhZ2VOYW1lOiAncHJvZCcsXHJcbiAgICAgIGFwaUlkOiBtYWlsSHR0cEFwaS5yZWYsXHJcbiAgICAgIGF1dG9EZXBsb3k6IHRydWUsXHJcbiAgICB9KTtcclxuICAgIG1haWxBcGlTdGFnZS5jZm5PcHRpb25zLmRlbGV0aW9uUG9saWN5ID0gY2RrLkNmbkRlbGV0aW9uUG9saWN5LkRFTEVURTtcclxuXHJcbiAgICBjb25zdCBhcGlEb21haW5OYW1lID0gaGFzQ3VzdG9tRG9tYWluXHJcbiAgICAgID8gbmV3IGFwaWdhdGV3YXl2Mi5DZm5Eb21haW5OYW1lKHRoaXMsICdBcGlEb21haW5OYW1lJywge1xyXG4gICAgICAgICAgZG9tYWluTmFtZTogYXBpQ3VzdG9tRG9tYWluTmFtZSxcclxuICAgICAgICAgIGRvbWFpbk5hbWVDb25maWd1cmF0aW9uczogW1xyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgY2VydGlmaWNhdGVBcm46IGNlcnRpZmljYXRlQXJuISxcclxuICAgICAgICAgICAgICBlbmRwb2ludFR5cGU6ICdSRUdJT05BTCcsXHJcbiAgICAgICAgICAgICAgc2VjdXJpdHlQb2xpY3k6ICdUTFNfMV8yJyxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIF0sXHJcbiAgICAgICAgfSlcclxuICAgICAgOiB1bmRlZmluZWQ7XHJcbiAgICBpZiAoYXBpRG9tYWluTmFtZSkge1xyXG4gICAgICBhcGlEb21haW5OYW1lLmNmbk9wdGlvbnMuZGVsZXRpb25Qb2xpY3kgPSBjZGsuQ2ZuRGVsZXRpb25Qb2xpY3kuREVMRVRFO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGFwaU1hcHBpbmcgPVxyXG4gICAgICBoYXNDdXN0b21Eb21haW4gJiYgYXBpRG9tYWluTmFtZVxyXG4gICAgICAgID8gbmV3IGFwaWdhdGV3YXl2Mi5DZm5BcGlNYXBwaW5nKHRoaXMsICdBcGlNYXBwaW5nJywge1xyXG4gICAgICAgICAgICBhcGlJZDogbWFpbEh0dHBBcGkucmVmLFxyXG4gICAgICAgICAgICBkb21haW5OYW1lOiBhcGlEb21haW5OYW1lLnJlZixcclxuICAgICAgICAgICAgc3RhZ2U6IG1haWxBcGlTdGFnZS5yZWYsXHJcbiAgICAgICAgICAgIGFwaU1hcHBpbmdLZXk6ICdleGFtcGxlcycsXHJcbiAgICAgICAgICB9KVxyXG4gICAgICAgIDogdW5kZWZpbmVkO1xyXG4gICAgaWYgKGFwaU1hcHBpbmcpIHtcclxuICAgICAgYXBpTWFwcGluZy5jZm5PcHRpb25zLmRlbGV0aW9uUG9saWN5ID0gY2RrLkNmbkRlbGV0aW9uUG9saWN5LkRFTEVURTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBhcGlEb21haW5SZWNvcmQgPVxyXG4gICAgICBoYXNDdXN0b21Eb21haW4gJiYgaGFzSG9zdGVkWm9uZSAmJiBhcGlEb21haW5OYW1lXHJcbiAgICAgICAgPyBuZXcgcm91dGU1My5DZm5SZWNvcmRTZXQodGhpcywgJ0FwaURvbWFpblJlY29yZCcsIHtcclxuICAgICAgICAgICAgaG9zdGVkWm9uZUlkLFxyXG4gICAgICAgICAgICBuYW1lOiBhcGlDdXN0b21Eb21haW5OYW1lLFxyXG4gICAgICAgICAgICB0eXBlOiAnQScsXHJcbiAgICAgICAgICAgIGFsaWFzVGFyZ2V0OiB7XHJcbiAgICAgICAgICAgICAgZG5zTmFtZTogYXBpRG9tYWluTmFtZS5hdHRyUmVnaW9uYWxEb21haW5OYW1lLFxyXG4gICAgICAgICAgICAgIGhvc3RlZFpvbmVJZDogYXBpRG9tYWluTmFtZS5hdHRyUmVnaW9uYWxIb3N0ZWRab25lSWQsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICB9KVxyXG4gICAgICAgIDogdW5kZWZpbmVkO1xyXG4gICAgaWYgKGFwaURvbWFpblJlY29yZCkge1xyXG4gICAgICBhcGlEb21haW5SZWNvcmQuY2ZuT3B0aW9ucy5kZWxldGlvblBvbGljeSA9IGNkay5DZm5EZWxldGlvblBvbGljeS5ERUxFVEU7XHJcbiAgICB9XHJcbiAgICBpZiAoYXBpTWFwcGluZyAmJiBhcGlEb21haW5OYW1lKSB7XHJcbiAgICAgIGFwaU1hcHBpbmcuYWRkRGVwZW5kZW5jeShhcGlEb21haW5OYW1lKTtcclxuICAgICAgYXBpTWFwcGluZy5hZGREZXBlbmRlbmN5KG1haWxBcGlTdGFnZSk7XHJcbiAgICB9XHJcbiAgICBpZiAoYXBpRG9tYWluUmVjb3JkICYmIGFwaURvbWFpbk5hbWUpIHtcclxuICAgICAgYXBpRG9tYWluUmVjb3JkLmFkZERlcGVuZGVuY3koYXBpRG9tYWluTmFtZSk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgYmFzZVVybCA9IGhhc0N1c3RvbURvbWFpblxyXG4gICAgICA/IGBodHRwczovLyR7YXBpQ3VzdG9tRG9tYWluTmFtZX0vZXhhbXBsZXMvZ21haWwtdmlld2VyYFxyXG4gICAgICA6IGNkay5Gbi5qb2luKCcnLCBbbWFpbEh0dHBBcGkuYXR0ckFwaUVuZHBvaW50LCAnLycsIG1haWxBcGlTdGFnZS5yZWYsICcvZ21haWwtdmlld2VyJ10pO1xyXG5cclxuICAgIGNvbnN0IHNlcnZpY2VOYW1lc3BhY2UgPSBuZXcgc2VydmljZWRpc2NvdmVyeS5DZm5Qcml2YXRlRG5zTmFtZXNwYWNlKHRoaXMsICdTZXJ2aWNlTmFtZXNwYWNlJywge1xyXG4gICAgICBuYW1lOiBzZXJ2aWNlRGlzY292ZXJ5TmFtZXNwYWNlTmFtZSxcclxuICAgICAgdnBjOiB2cGMudnBjSWQsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnTmFtZXNwYWNlIGZvciBtYWlsIHNlcnZpY2VzJyxcclxuICAgIH0pO1xyXG4gICAgc2VydmljZU5hbWVzcGFjZS5jZm5PcHRpb25zLmRlbGV0aW9uUG9saWN5ID0gY2RrLkNmbkRlbGV0aW9uUG9saWN5LkRFTEVURTtcclxuXHJcbiAgICBjb25zdCBhcGlWcGNMaW5rID0gbmV3IGFwaWdhdGV3YXl2Mi5DZm5WcGNMaW5rKHRoaXMsICdBcGlWcGNMaW5rJywge1xyXG4gICAgICBuYW1lOiAnbWFpbC1leGFtcGxlLXZwY2xpbmsnLFxyXG4gICAgICBzdWJuZXRJZHM6IHNlcnZpY2VTdWJuZXRJZHMsXHJcbiAgICAgIHNlY3VyaXR5R3JvdXBJZHM6IFthcGlWcGNMaW5rU2VjdXJpdHlHcm91cC5yZWZdLFxyXG4gICAgfSk7XHJcbiAgICBhcGlWcGNMaW5rLmNmbk9wdGlvbnMuZGVsZXRpb25Qb2xpY3kgPSBjZGsuQ2ZuRGVsZXRpb25Qb2xpY3kuREVMRVRFO1xyXG5cclxuICAgIGNvbnN0IGFwcENsb3VkTWFwU2VydmljZSA9IG5ldyBzZXJ2aWNlZGlzY292ZXJ5LkNmblNlcnZpY2UodGhpcywgJ0FwcENsb3VkTWFwU2VydmljZScsIHtcclxuICAgICAgbmFtZTogJ21haWwtZXhhbXBsZScsXHJcbiAgICAgIG5hbWVzcGFjZUlkOiBzZXJ2aWNlTmFtZXNwYWNlLnJlZixcclxuICAgICAgZG5zQ29uZmlnOiB7XHJcbiAgICAgICAgcm91dGluZ1BvbGljeTogJ1dFSUdIVEVEJyxcclxuICAgICAgICBkbnNSZWNvcmRzOiBbXHJcbiAgICAgICAgICB7XHJcbiAgICAgICAgICAgIHR0bDogc2VydmljZURpc2NvdmVyeVR0bCxcclxuICAgICAgICAgICAgdHlwZTogJ1NSVicsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIF0sXHJcbiAgICAgIH0sXHJcbiAgICAgIGhlYWx0aENoZWNrQ3VzdG9tQ29uZmlnOiB7XHJcbiAgICAgICAgZmFpbHVyZVRocmVzaG9sZDogMSxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gICAgYXBwQ2xvdWRNYXBTZXJ2aWNlLmNmbk9wdGlvbnMuZGVsZXRpb25Qb2xpY3kgPSBjZGsuQ2ZuRGVsZXRpb25Qb2xpY3kuREVMRVRFO1xyXG5cclxuICAgIGNvbnN0IHRhc2tFeGVjdXRpb25Sb2xlID0gbmV3IGlhbS5DZm5Sb2xlKHRoaXMsICdUYXNrRXhlY3V0aW9uUm9sZScsIHtcclxuICAgICAgYXNzdW1lUm9sZVBvbGljeURvY3VtZW50OiB7XHJcbiAgICAgICAgVmVyc2lvbjogJzIwMTItMTAtMTcnLFxyXG4gICAgICAgIFN0YXRlbWVudDogW1xyXG4gICAgICAgICAge1xyXG4gICAgICAgICAgICBFZmZlY3Q6ICdBbGxvdycsXHJcbiAgICAgICAgICAgIFByaW5jaXBhbDoge1xyXG4gICAgICAgICAgICAgIFNlcnZpY2U6ICdlY3MtdGFza3MuYW1hem9uYXdzLmNvbScsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIEFjdGlvbjogJ3N0czpBc3N1bWVSb2xlJyxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgXSxcclxuICAgICAgfSxcclxuICAgICAgbWFuYWdlZFBvbGljeUFybnM6IFsnYXJuOmF3czppYW06OmF3czpwb2xpY3kvc2VydmljZS1yb2xlL0FtYXpvbkVDU1Rhc2tFeGVjdXRpb25Sb2xlUG9saWN5J10sXHJcbiAgICAgIHBvbGljaWVzOiBbXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgcG9saWN5TmFtZTogJ0FsbG93UGFyYW1ldGVyUmVhZEZvclNlY3JldHMnLFxyXG4gICAgICAgICAgcG9saWN5RG9jdW1lbnQ6IHtcclxuICAgICAgICAgICAgVmVyc2lvbjogJzIwMTItMTAtMTcnLFxyXG4gICAgICAgICAgICBTdGF0ZW1lbnQ6IFtcclxuICAgICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBFZmZlY3Q6ICdBbGxvdycsXHJcbiAgICAgICAgICAgICAgICBBY3Rpb246IFsnc3NtOkdldFBhcmFtZXRlcicsICdzc206R2V0UGFyYW1ldGVycycsICdzc206R2V0UGFyYW1ldGVyc0J5UGF0aCcsICdrbXM6RGVjcnlwdCddLFxyXG4gICAgICAgICAgICAgICAgUmVzb3VyY2U6IFtcclxuICAgICAgICAgICAgICAgICAgYGFybjphd3M6c3NtOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpwYXJhbWV0ZXIke3NzbVByZWZpeH0qYCxcclxuICAgICAgICAgICAgICAgICAgYGFybjphd3M6a21zOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTprZXkvKmAsXHJcbiAgICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIF0sXHJcbiAgICB9KTtcclxuICAgIHRhc2tFeGVjdXRpb25Sb2xlLmNmbk9wdGlvbnMuZGVsZXRpb25Qb2xpY3kgPSBjZGsuQ2ZuRGVsZXRpb25Qb2xpY3kuREVMRVRFO1xyXG5cclxuICAgIGNvbnN0IHRhc2tSb2xlID0gbmV3IGlhbS5DZm5Sb2xlKHRoaXMsICdUYXNrUm9sZScsIHtcclxuICAgICAgYXNzdW1lUm9sZVBvbGljeURvY3VtZW50OiB7XHJcbiAgICAgICAgVmVyc2lvbjogJzIwMTItMTAtMTcnLFxyXG4gICAgICAgIFN0YXRlbWVudDogW1xyXG4gICAgICAgICAge1xyXG4gICAgICAgICAgICBFZmZlY3Q6ICdBbGxvdycsXHJcbiAgICAgICAgICAgIFByaW5jaXBhbDoge1xyXG4gICAgICAgICAgICAgIFNlcnZpY2U6ICdlY3MtdGFza3MuYW1hem9uYXdzLmNvbScsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIEFjdGlvbjogJ3N0czpBc3N1bWVSb2xlJyxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgXSxcclxuICAgICAgfSxcclxuICAgICAgcG9saWNpZXM6IFtcclxuICAgICAgICB7XHJcbiAgICAgICAgICBwb2xpY3lOYW1lOiAnQXBwUnVudGltZUNvbmZpZ1JlYWQnLFxyXG4gICAgICAgICAgcG9saWN5RG9jdW1lbnQ6IHtcclxuICAgICAgICAgICAgVmVyc2lvbjogJzIwMTItMTAtMTcnLFxyXG4gICAgICAgICAgICBTdGF0ZW1lbnQ6IFtcclxuICAgICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBFZmZlY3Q6ICdBbGxvdycsXHJcbiAgICAgICAgICAgICAgICBBY3Rpb246IFsnc3NtOkdldFBhcmFtZXRlcicsICdzc206R2V0UGFyYW1ldGVycycsICdzc206R2V0UGFyYW1ldGVyc0J5UGF0aCcsICdrbXM6RGVjcnlwdCddLFxyXG4gICAgICAgICAgICAgICAgUmVzb3VyY2U6IFtcclxuICAgICAgICAgICAgICAgICAgYGFybjphd3M6c3NtOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpwYXJhbWV0ZXIke3NzbVByZWZpeH0qYCxcclxuICAgICAgICAgICAgICAgICAgYGFybjphd3M6a21zOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTprZXkvKmAsXHJcbiAgICAgICAgICAgICAgICBdLFxyXG4gICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIF0sXHJcbiAgICB9KTtcclxuICAgIHRhc2tSb2xlLmNmbk9wdGlvbnMuZGVsZXRpb25Qb2xpY3kgPSBjZGsuQ2ZuRGVsZXRpb25Qb2xpY3kuREVMRVRFO1xyXG5cclxuICAgIGNvbnN0IGFwcFRhc2tEZWZpbml0aW9uID0gbmV3IGVjcy5DZm5UYXNrRGVmaW5pdGlvbih0aGlzLCAnQXBwVGFza0RlZmluaXRpb24nLCB7XHJcbiAgICAgIGZhbWlseTogJ21haWwtZXhhbXBsZScsXHJcbiAgICAgIGNwdTogY29udGFpbmVyQ3B1LnRvU3RyaW5nKCksXHJcbiAgICAgIG1lbW9yeTogY29udGFpbmVyTWVtb3J5LnRvU3RyaW5nKCksXHJcbiAgICAgIG5ldHdvcmtNb2RlOiAnYXdzdnBjJyxcclxuICAgICAgcmVxdWlyZXNDb21wYXRpYmlsaXRpZXM6IFsnRkFSR0FURSddLFxyXG4gICAgICBleGVjdXRpb25Sb2xlQXJuOiB0YXNrRXhlY3V0aW9uUm9sZS5hdHRyQXJuLFxyXG4gICAgICB0YXNrUm9sZUFybjogdGFza1JvbGUuYXR0ckFybixcclxuICAgICAgY29udGFpbmVyRGVmaW5pdGlvbnM6IFtcclxuICAgICAgICB7XHJcbiAgICAgICAgICBuYW1lOiAnbWFpbC1leGFtcGxlJyxcclxuICAgICAgICAgIGltYWdlOiBgJHttYWlsRXhhbXBsZVJlcG9zaXRvcnkuYXR0clJlcG9zaXRvcnlVcml9OmxhdGVzdGAsXHJcbiAgICAgICAgICBwb3J0TWFwcGluZ3M6IFtcclxuICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgIGNvbnRhaW5lclBvcnQsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICBdLFxyXG4gICAgICAgICAgbG9nQ29uZmlndXJhdGlvbjoge1xyXG4gICAgICAgICAgICBsb2dEcml2ZXI6ICdhd3Nsb2dzJyxcclxuICAgICAgICAgICAgb3B0aW9uczoge1xyXG4gICAgICAgICAgICAgICdhd3Nsb2dzLWdyb3VwJzogYXBwTG9nR3JvdXAucmVmLFxyXG4gICAgICAgICAgICAgICdhd3Nsb2dzLXJlZ2lvbic6IHRoaXMucmVnaW9uLFxyXG4gICAgICAgICAgICAgICdhd3Nsb2dzLXN0cmVhbS1wcmVmaXgnOiAnbWFpbC1leGFtcGxlJyxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICBlbnZpcm9ubWVudDogW1xyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgbmFtZTogJ0NPTkZJR19TU01fUFJFRklYJyxcclxuICAgICAgICAgICAgICB2YWx1ZTogc3NtUHJlZml4LFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgbmFtZTogJ1BPUlQnLFxyXG4gICAgICAgICAgICAgIHZhbHVlOiBjb250YWluZXJQb3J0LnRvU3RyaW5nKCksXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICBuYW1lOiAnQkFTRV9VUkwnLFxyXG4gICAgICAgICAgICAgIHZhbHVlOiBiYXNlVXJsLnRvU3RyaW5nKCksXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICBuYW1lOiAnTk9ERV9FTlYnLFxyXG4gICAgICAgICAgICAgIHZhbHVlOiBwdWJsaWNFbnZWYWx1ZSxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIF0sXHJcbiAgICAgICAgICBzZWNyZXRzOiBbXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICBuYW1lOiAnR09PR0xFX0NMSUVOVF9JRCcsXHJcbiAgICAgICAgICAgICAgdmFsdWVGcm9tOiBgYXJuOmF3czpzc206JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OnBhcmFtZXRlciR7c3NtUHJlZml4fS9lbnYvR09PR0xFX0NMSUVOVF9JRGAsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICBuYW1lOiAnR09PR0xFX0NMSUVOVF9TRUNSRVQnLFxyXG4gICAgICAgICAgICAgIHZhbHVlRnJvbTogYGFybjphd3M6c3NtOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpwYXJhbWV0ZXIke3NzbVByZWZpeH0vc2VjcmV0cy9HT09HTEVfQ0xJRU5UX1NFQ1JFVGAsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICBuYW1lOiAnU0VTU0lPTl9TRUNSRVQnLFxyXG4gICAgICAgICAgICAgIHZhbHVlRnJvbTogYGFybjphd3M6c3NtOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpwYXJhbWV0ZXIke3NzbVByZWZpeH0vc2VjcmV0cy9TRVNTSU9OX1NFQ1JFVGAsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICBdLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIF0sXHJcbiAgICB9KTtcclxuICAgIGFwcFRhc2tEZWZpbml0aW9uLmNmbk9wdGlvbnMuZGVsZXRpb25Qb2xpY3kgPSBjZGsuQ2ZuRGVsZXRpb25Qb2xpY3kuREVMRVRFO1xyXG5cclxuICAgIG5ldyBlY3MuQ2ZuU2VydmljZSh0aGlzLCAnQXBwU2VydmljZScsIHtcclxuICAgICAgc2VydmljZU5hbWU6ICdtYWlsLWV4YW1wbGUnLFxyXG4gICAgICBjbHVzdGVyOiBtYWlsQ2x1c3Rlci5yZWYsXHJcbiAgICAgIHRhc2tEZWZpbml0aW9uOiBhcHBUYXNrRGVmaW5pdGlvbi5yZWYsXHJcbiAgICAgIGRlc2lyZWRDb3VudCxcclxuICAgICAgY2FwYWNpdHlQcm92aWRlclN0cmF0ZWd5OiBbXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgY2FwYWNpdHlQcm92aWRlcjogJ0ZBUkdBVEVfU1BPVCcsXHJcbiAgICAgICAgICB3ZWlnaHQ6IDQsXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7XHJcbiAgICAgICAgICBjYXBhY2l0eVByb3ZpZGVyOiAnRkFSR0FURScsXHJcbiAgICAgICAgICB3ZWlnaHQ6IDEsXHJcbiAgICAgICAgfSxcclxuICAgICAgXSxcclxuICAgICAgZGVwbG95bWVudENvbmZpZ3VyYXRpb246IHtcclxuICAgICAgICBtYXhpbXVtUGVyY2VudDogMjAwLFxyXG4gICAgICAgIG1pbmltdW1IZWFsdGh5UGVyY2VudDogNTAsXHJcbiAgICAgIH0sXHJcbiAgICAgIG5ldHdvcmtDb25maWd1cmF0aW9uOiB7XHJcbiAgICAgICAgYXdzdnBjQ29uZmlndXJhdGlvbjoge1xyXG4gICAgICAgICAgYXNzaWduUHVibGljSXA6ICdESVNBQkxFRCcsXHJcbiAgICAgICAgICBzdWJuZXRzOiBzZXJ2aWNlU3VibmV0SWRzLFxyXG4gICAgICAgICAgc2VjdXJpdHlHcm91cHM6IFtzZXJ2aWNlU2VjdXJpdHlHcm91cC5yZWZdLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0sXHJcbiAgICAgIHNlcnZpY2VSZWdpc3RyaWVzOiBbXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgcmVnaXN0cnlBcm46IGFwcENsb3VkTWFwU2VydmljZS5hdHRyQXJuLFxyXG4gICAgICAgICAgY29udGFpbmVyTmFtZTogJ21haWwtZXhhbXBsZScsXHJcbiAgICAgICAgICBjb250YWluZXJQb3J0OiBjb250YWluZXJQb3J0LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIF0sXHJcbiAgICAgIHBsYXRmb3JtVmVyc2lvbjogJ0xBVEVTVCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBtYWlsSW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheXYyLkNmbkludGVncmF0aW9uKHRoaXMsICdNYWlsSW50ZWdyYXRpb24nLCB7XHJcbiAgICAgIGFwaUlkOiBtYWlsSHR0cEFwaS5yZWYsXHJcbiAgICAgIGludGVncmF0aW9uVHlwZTogJ0hUVFBfUFJPWFknLFxyXG4gICAgICBpbnRlZ3JhdGlvbk1ldGhvZDogJ0FOWScsXHJcbiAgICAgIGludGVncmF0aW9uVXJpOiBhcHBDbG91ZE1hcFNlcnZpY2UuYXR0ckFybixcclxuICAgICAgY29ubmVjdGlvblR5cGU6ICdWUENfTElOSycsXHJcbiAgICAgIGNvbm5lY3Rpb25JZDogYXBpVnBjTGluay5yZWYsXHJcbiAgICAgIHBheWxvYWRGb3JtYXRWZXJzaW9uOiAnMS4wJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBhcGlnYXRld2F5djIuQ2ZuUm91dGUodGhpcywgJ0dtYWlsVmlld2VyUm91dGUnLCB7XHJcbiAgICAgIGFwaUlkOiBtYWlsSHR0cEFwaS5yZWYsXHJcbiAgICAgIHJvdXRlS2V5OiAnQU5ZIC9nbWFpbC12aWV3ZXInLFxyXG4gICAgICB0YXJnZXQ6IGBpbnRlZ3JhdGlvbnMvJHttYWlsSW50ZWdyYXRpb24ucmVmfWAsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgYXBpZ2F0ZXdheXYyLkNmblJvdXRlKHRoaXMsICdHbWFpbFZpZXdlclByb3h5Um91dGUnLCB7XHJcbiAgICAgIGFwaUlkOiBtYWlsSHR0cEFwaS5yZWYsXHJcbiAgICAgIHJvdXRlS2V5OiAnQU5ZIC9nbWFpbC12aWV3ZXIve3Byb3h5K30nLFxyXG4gICAgICB0YXJnZXQ6IGBpbnRlZ3JhdGlvbnMvJHttYWlsSW50ZWdyYXRpb24ucmVmfWAsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBzc21CYXNlVXJsID0gbmV3IHNzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgJ1NzbUJhc2VVcmwnLCB7XHJcbiAgICAgIHBhcmFtZXRlck5hbWU6IGAke3NzbVByZWZpeH0vZW52L0JBU0VfVVJMYCxcclxuICAgICAgc3RyaW5nVmFsdWU6IGJhc2VVcmwsXHJcbiAgICAgIHR5cGU6IHNzbS5QYXJhbWV0ZXJUeXBlLlNUUklORyxcclxuICAgIH0pO1xyXG4gICAgKHNzbUJhc2VVcmwubm9kZS5kZWZhdWx0Q2hpbGQgYXMgc3NtLkNmblBhcmFtZXRlcikuY2ZuT3B0aW9ucy5kZWxldGlvblBvbGljeSA9IGNkay5DZm5EZWxldGlvblBvbGljeS5ERUxFVEU7XHJcblxyXG4gICAgY29uc3Qgc3NtR29vZ2xlQ2xpZW50SWQgPSBuZXcgc3NtLlN0cmluZ1BhcmFtZXRlcih0aGlzLCAnU3NtR29vZ2xlQ2xpZW50SWQnLCB7XHJcbiAgICAgIHBhcmFtZXRlck5hbWU6IGAke3NzbVByZWZpeH0vZW52L0dPT0dMRV9DTElFTlRfSURgLFxyXG4gICAgICBzdHJpbmdWYWx1ZTogZ29vZ2xlQ2xpZW50SWQsXHJcbiAgICAgIHR5cGU6IHNzbS5QYXJhbWV0ZXJUeXBlLlNUUklORyxcclxuICAgIH0pO1xyXG4gICAgKHNzbUdvb2dsZUNsaWVudElkLm5vZGUuZGVmYXVsdENoaWxkIGFzIHNzbS5DZm5QYXJhbWV0ZXIpLmNmbk9wdGlvbnMuZGVsZXRpb25Qb2xpY3kgPSBjZGsuQ2ZuRGVsZXRpb25Qb2xpY3kuREVMRVRFO1xyXG5cclxuICAgIGNvbnN0IHNzbUdvb2dsZUNsaWVudFNlY3JldCA9IG5ldyBzc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsICdTc21Hb29nbGVDbGllbnRTZWNyZXQnLCB7XHJcbiAgICAgIHBhcmFtZXRlck5hbWU6IGAke3NzbVByZWZpeH0vc2VjcmV0cy9HT09HTEVfQ0xJRU5UX1NFQ1JFVGAsXHJcbiAgICAgIHN0cmluZ1ZhbHVlOiBnb29nbGVDbGllbnRTZWNyZXQsXHJcbiAgICAgIHR5cGU6IHNzbS5QYXJhbWV0ZXJUeXBlLlNUUklORyxcclxuICAgIH0pO1xyXG4gICAgKHNzbUdvb2dsZUNsaWVudFNlY3JldC5ub2RlLmRlZmF1bHRDaGlsZCBhcyBzc20uQ2ZuUGFyYW1ldGVyKS5jZm5PcHRpb25zLmRlbGV0aW9uUG9saWN5ID0gY2RrLkNmbkRlbGV0aW9uUG9saWN5LkRFTEVURTtcclxuXHJcbiAgICBjb25zdCBzc21Qb3J0ID0gbmV3IHNzbS5TdHJpbmdQYXJhbWV0ZXIodGhpcywgJ1NzbVBvcnQnLCB7XHJcbiAgICAgIHBhcmFtZXRlck5hbWU6IGAke3NzbVByZWZpeH0vZW52L1BPUlRgLFxyXG4gICAgICBzdHJpbmdWYWx1ZTogY29udGFpbmVyUG9ydC50b1N0cmluZygpLFxyXG4gICAgICB0eXBlOiBzc20uUGFyYW1ldGVyVHlwZS5TVFJJTkcsXHJcbiAgICB9KTtcclxuICAgIChzc21Qb3J0Lm5vZGUuZGVmYXVsdENoaWxkIGFzIHNzbS5DZm5QYXJhbWV0ZXIpLmNmbk9wdGlvbnMuZGVsZXRpb25Qb2xpY3kgPSBjZGsuQ2ZuRGVsZXRpb25Qb2xpY3kuREVMRVRFO1xyXG5cclxuICAgIGNvbnN0IHNzbVB1YmxpY0VudiA9IG5ldyBzc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsICdTc21QdWJsaWNFbnYnLCB7XHJcbiAgICAgIHBhcmFtZXRlck5hbWU6IGAke3NzbVByZWZpeH0vZW52L05PREVfRU5WYCxcclxuICAgICAgc3RyaW5nVmFsdWU6IHB1YmxpY0VudlZhbHVlLFxyXG4gICAgICB0eXBlOiBzc20uUGFyYW1ldGVyVHlwZS5TVFJJTkcsXHJcbiAgICB9KTtcclxuICAgIChzc21QdWJsaWNFbnYubm9kZS5kZWZhdWx0Q2hpbGQgYXMgc3NtLkNmblBhcmFtZXRlcikuY2ZuT3B0aW9ucy5kZWxldGlvblBvbGljeSA9IGNkay5DZm5EZWxldGlvblBvbGljeS5ERUxFVEU7XHJcblxyXG4gICAgY29uc3Qgc3NtU2Vzc2lvblNlY3JldCA9IG5ldyBzc20uU3RyaW5nUGFyYW1ldGVyKHRoaXMsICdTc21TZXNzaW9uU2VjcmV0Jywge1xyXG4gICAgICBwYXJhbWV0ZXJOYW1lOiBgJHtzc21QcmVmaXh9L3NlY3JldHMvU0VTU0lPTl9TRUNSRVRgLFxyXG4gICAgICBzdHJpbmdWYWx1ZTogc2Vzc2lvblNlY3JldFZhbHVlLFxyXG4gICAgICB0eXBlOiBzc20uUGFyYW1ldGVyVHlwZS5TVFJJTkcsXHJcbiAgICB9KTtcclxuICAgIChzc21TZXNzaW9uU2VjcmV0Lm5vZGUuZGVmYXVsdENoaWxkIGFzIHNzbS5DZm5QYXJhbWV0ZXIpLmNmbk9wdGlvbnMuZGVsZXRpb25Qb2xpY3kgPSBjZGsuQ2ZuRGVsZXRpb25Qb2xpY3kuREVMRVRFO1xyXG5cclxuICAgIGNvbnN0IGNvZGVCdWlsZFJvbGUgPSBuZXcgaWFtLkNmblJvbGUodGhpcywgJ0NvZGVCdWlsZFJvbGUnLCB7XHJcbiAgICAgIGFzc3VtZVJvbGVQb2xpY3lEb2N1bWVudDoge1xyXG4gICAgICAgIFZlcnNpb246ICcyMDEyLTEwLTE3JyxcclxuICAgICAgICBTdGF0ZW1lbnQ6IFtcclxuICAgICAgICAgIHtcclxuICAgICAgICAgICAgRWZmZWN0OiAnQWxsb3cnLFxyXG4gICAgICAgICAgICBQcmluY2lwYWw6IHtcclxuICAgICAgICAgICAgICBTZXJ2aWNlOiAnY29kZWJ1aWxkLmFtYXpvbmF3cy5jb20nLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICBBY3Rpb246ICdzdHM6QXNzdW1lUm9sZScsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIF0sXHJcbiAgICAgIH0sXHJcbiAgICAgIHBvbGljaWVzOiBbXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgcG9saWN5TmFtZTogJ0J1aWxkTG9ncycsXHJcbiAgICAgICAgICBwb2xpY3lEb2N1bWVudDoge1xyXG4gICAgICAgICAgICBWZXJzaW9uOiAnMjAxMi0xMC0xNycsXHJcbiAgICAgICAgICAgIFN0YXRlbWVudDogW1xyXG4gICAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIEVmZmVjdDogJ0FsbG93JyxcclxuICAgICAgICAgICAgICAgIEFjdGlvbjogWydsb2dzOkNyZWF0ZUxvZ0dyb3VwJywgJ2xvZ3M6Q3JlYXRlTG9nU3RyZWFtJywgJ2xvZ3M6UHV0TG9nRXZlbnRzJ10sXHJcbiAgICAgICAgICAgICAgICBSZXNvdXJjZTogJyonLFxyXG4gICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgcG9saWN5TmFtZTogJ0VDUlB1c2gnLFxyXG4gICAgICAgICAgcG9saWN5RG9jdW1lbnQ6IHtcclxuICAgICAgICAgICAgVmVyc2lvbjogJzIwMTItMTAtMTcnLFxyXG4gICAgICAgICAgICBTdGF0ZW1lbnQ6IFtcclxuICAgICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBFZmZlY3Q6ICdBbGxvdycsXHJcbiAgICAgICAgICAgICAgICBBY3Rpb246IFtcclxuICAgICAgICAgICAgICAgICAgJ2VjcjpHZXRBdXRob3JpemF0aW9uVG9rZW4nLFxyXG4gICAgICAgICAgICAgICAgICAnZWNyOkJhdGNoQ2hlY2tMYXllckF2YWlsYWJpbGl0eScsXHJcbiAgICAgICAgICAgICAgICAgICdlY3I6Q29tcGxldGVMYXllclVwbG9hZCcsXHJcbiAgICAgICAgICAgICAgICAgICdlY3I6QmF0Y2hHZXRJbWFnZScsXHJcbiAgICAgICAgICAgICAgICAgICdlY3I6RGVzY3JpYmVSZXBvc2l0b3JpZXMnLFxyXG4gICAgICAgICAgICAgICAgICAnZWNyOkluaXRpYXRlTGF5ZXJVcGxvYWQnLFxyXG4gICAgICAgICAgICAgICAgICAnZWNyOlB1dEltYWdlJyxcclxuICAgICAgICAgICAgICAgICAgJ2VjcjpVcGxvYWRMYXllclBhcnQnLFxyXG4gICAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgICAgIFJlc291cmNlOiAnKicsXHJcbiAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgXSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgICAgICB7XHJcbiAgICAgICAgICBwb2xpY3lOYW1lOiAnRUNTRGVwbG95JyxcclxuICAgICAgICAgIHBvbGljeURvY3VtZW50OiB7XHJcbiAgICAgICAgICAgIFZlcnNpb246ICcyMDEyLTEwLTE3JyxcclxuICAgICAgICAgICAgU3RhdGVtZW50OiBbXHJcbiAgICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgRWZmZWN0OiAnQWxsb3cnLFxyXG4gICAgICAgICAgICAgICAgQWN0aW9uOiBbJ2VjczpVcGRhdGVTZXJ2aWNlJywgJ2VjczpEZXNjcmliZVNlcnZpY2VzJywgJ2VjczpEZXNjcmliZUNsdXN0ZXJzJ10sXHJcbiAgICAgICAgICAgICAgICBSZXNvdXJjZTogJyonLFxyXG4gICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgcG9saWN5TmFtZTogJ1NTTVJlYWRGb3JCdWlsZCcsXHJcbiAgICAgICAgICBwb2xpY3lEb2N1bWVudDoge1xyXG4gICAgICAgICAgICBWZXJzaW9uOiAnMjAxMi0xMC0xNycsXHJcbiAgICAgICAgICAgIFN0YXRlbWVudDogW1xyXG4gICAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIEVmZmVjdDogJ0FsbG93JyxcclxuICAgICAgICAgICAgICAgIEFjdGlvbjogWydzc206R2V0UGFyYW1ldGVyJywgJ3NzbTpHZXRQYXJhbWV0ZXJzJywgJ3NzbTpHZXRQYXJhbWV0ZXJzQnlQYXRoJ10sXHJcbiAgICAgICAgICAgICAgICBSZXNvdXJjZTogJyonLFxyXG4gICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIF0sXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgcG9saWN5TmFtZTogJ0NvZGVDb25uZWN0aW9uQWNjZXNzJyxcclxuICAgICAgICAgIHBvbGljeURvY3VtZW50OiB7XHJcbiAgICAgICAgICAgIFZlcnNpb246ICcyMDEyLTEwLTE3JyxcclxuICAgICAgICAgICAgU3RhdGVtZW50OiBbXHJcbiAgICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgRWZmZWN0OiAnQWxsb3cnLFxyXG4gICAgICAgICAgICAgICAgQWN0aW9uOiBbXHJcbiAgICAgICAgICAgICAgICBcImNvZGVjb25uZWN0aW9uczpHZXRDb25uZWN0aW9uXCIsXHJcbiAgICAgICAgICAgICAgICBcImNvZGVjb25uZWN0aW9uczpHZXRDb25uZWN0aW9uVG9rZW5cIixcclxuICAgICAgICAgICAgICAgIFwiY29kZWNvbm5lY3Rpb25zOlVzZUNvbm5lY3Rpb25cIlxyXG4gICAgICAgICAgICAgICAgXSxcclxuICAgICAgICAgICAgICAgIFJlc291cmNlOiBwcm9wcy5jb2RlQ29ubmVjdGlvbkFybixcclxuICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICBdLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9XHJcbiAgICAgIF0sXHJcbiAgICB9KTtcclxuICAgIGNvZGVCdWlsZFJvbGUuY2ZuT3B0aW9ucy5kZWxldGlvblBvbGljeSA9IGNkay5DZm5EZWxldGlvblBvbGljeS5ERUxFVEU7XHJcblxyXG4gICAgLy8gVXNlIHRoZSBoaWdoZXItbGV2ZWwgUHJvamVjdCBjb25zdHJ1Y3Qgc28gd2UgY2FuIHByb3ZpZGUgYSB0eXBlZCBCdWlsZFNwZWNcclxuICAgIGNvbnN0IGNvZGVidWlsZFJvbGVSZWYgPSBpYW0uUm9sZS5mcm9tUm9sZUFybih0aGlzLCAnQ29kZUJ1aWxkUm9sZVJlZicsIGNvZGVCdWlsZFJvbGUuYXR0ckFybik7XHJcblxyXG4gICAgY29uc3QgY29kZUJ1aWxkUHJvamVjdCA9IG5ldyBjb2RlYnVpbGQuUHJvamVjdCh0aGlzLCAnQ29kZUJ1aWxkUHJvamVjdCcsIHtcclxuICAgICAgcHJvamVjdE5hbWU6ICdtYWlsLWV4YW1wbGUnLFxyXG4gICAgICByb2xlOiBjb2RlYnVpbGRSb2xlUmVmLFxyXG4gICAgICBlbnZpcm9ubWVudDoge1xyXG4gICAgICAgIGJ1aWxkSW1hZ2U6IGNvZGVidWlsZC5MaW51eEJ1aWxkSW1hZ2UuU1RBTkRBUkRfN18wLFxyXG4gICAgICAgIGNvbXB1dGVUeXBlOiBjb2RlYnVpbGQuQ29tcHV0ZVR5cGUuU01BTEwsXHJcbiAgICAgICAgcHJpdmlsZWdlZDogdHJ1ZSxcclxuICAgICAgICBlbnZpcm9ubWVudFZhcmlhYmxlczoge1xyXG4gICAgICAgICAgRUNSX1VSSTogeyB2YWx1ZTogbWFpbEV4YW1wbGVSZXBvc2l0b3J5LmF0dHJSZXBvc2l0b3J5VXJpIH0sXHJcbiAgICAgICAgICBDTFVTVEVSX05BTUU6IHsgdmFsdWU6IG1haWxDbHVzdGVyLnJlZiB9LFxyXG4gICAgICAgICAgU0VSVklDRV9OQU1FOiB7IHZhbHVlOiAnbWFpbC1leGFtcGxlJyB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0sXHJcbiAgICAgIHNvdXJjZTogY29kZWJ1aWxkLlNvdXJjZS5naXRIdWIoeyBvd25lcjogZ2l0SHViT3duZXIsIHJlcG86IGdpdEh1YlJlcG8sIGJyYW5jaE9yUmVmOiBnaXRIdWJCcmFuY2gsIH0pLFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygzMCksXHJcbiAgICAgIHF1ZXVlZFRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDMwKSxcclxuICAgICAgYmFkZ2U6IHRydWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQnVpbGQgJiBkZXBsb3kgbWFpbC1leGFtcGxlIHRvIEVDUiB0aGVuIGZvcmNlIEVDUyBkZXBsb3knLFxyXG4gICAgICBjYWNoZTogY29kZWJ1aWxkLkNhY2hlLm5vbmUoKSxcclxuICAgICAgYnVpbGRTcGVjOiBjb2RlYnVpbGQuQnVpbGRTcGVjLmZyb21PYmplY3Qoe1xyXG4gICAgICAgIHZlcnNpb246ICcwLjInLFxyXG4gICAgICAgIHBoYXNlczoge1xyXG4gICAgICAgICAgcHJlX2J1aWxkOiB7IGNvbW1hbmRzOiBbXHJcbiAgICAgICAgICAgICdlY2hvIFwiTG9nZ2luZyBpbiB0byBFQ1JcIicsXHJcbiAgICAgICAgICAgICdhd3MgZWNyIGdldC1sb2dpbi1wYXNzd29yZCAtLXJlZ2lvbiAkQVdTX0RFRkFVTFRfUkVHSU9OIHwgZG9ja2VyIGxvZ2luIC0tdXNlcm5hbWUgQVdTIC0tcGFzc3dvcmQtc3RkaW4gJEVDUl9VUkknLFxyXG4gICAgICAgICAgICAnSU1BR0VfVEFHPSR7Q09ERUJVSUxEX1JFU09MVkVEX1NPVVJDRV9WRVJTSU9OOi1sYXRlc3R9JyxcclxuICAgICAgICAgIF19LFxyXG4gICAgICAgICAgYnVpbGQ6IHsgY29tbWFuZHM6IFtcclxuICAgICAgICAgICAgJ2NkIGV4YW1wbGVzL2dtYWlsLXZpZXdlcicsXHJcbiAgICAgICAgICAgICdkb2NrZXIgYnVpbGQgLXQgJEVDUl9VUkk6bGF0ZXN0IC10ICRFQ1JfVVJJOiRJTUFHRV9UQUcgLicsXHJcbiAgICAgICAgICBdIH0sXHJcbiAgICAgICAgICBwb3N0X2J1aWxkOiB7IGNvbW1hbmRzOiBbXHJcbiAgICAgICAgICAgICdkb2NrZXIgcHVzaCAkRUNSX1VSSTpsYXRlc3QnLFxyXG4gICAgICAgICAgICAnZG9ja2VyIHB1c2ggJEVDUl9VUkk6JElNQUdFX1RBRycsXHJcbiAgICAgICAgICAgICdhd3MgZWNzIHVwZGF0ZS1zZXJ2aWNlIC0tY2x1c3RlciAkQ0xVU1RFUl9OQU1FIC0tc2VydmljZSAkU0VSVklDRV9OQU1FIC0tZm9yY2UtbmV3LWRlcGxveW1lbnQnLFxyXG4gICAgICAgICAgXX0sXHJcbiAgICAgICAgfSxcclxuICAgICAgICBhcnRpZmFjdHM6IHsgZmlsZXM6IFtdIH0sXHJcbiAgICAgICAgZW52OiB7IHNoZWxsOiAnYmFzaCcgfSxcclxuICAgICAgfSksXHJcbiAgICB9KTtcclxuICAgIChjb2RlQnVpbGRQcm9qZWN0Lm5vZGUuZGVmYXVsdENoaWxkIGFzIGNvZGVidWlsZC5DZm5Qcm9qZWN0KS5jZm5PcHRpb25zLmRlbGV0aW9uUG9saWN5ID0gY2RrLkNmbkRlbGV0aW9uUG9saWN5LkRFTEVURTtcclxuXHJcbiAgICB0aGlzLmNsdXN0ZXJOYW1lID0gbWFpbENsdXN0ZXIucmVmO1xyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Nmbk91dHB1dENsdXN0ZXJOYW1lJywge1xyXG4gICAgICBrZXk6ICdDbHVzdGVyTmFtZScsXHJcbiAgICAgIHZhbHVlOiB0aGlzLmNsdXN0ZXJOYW1lLnRvU3RyaW5nKCksXHJcbiAgICB9KTtcclxuICAgIHRoaXMucmVwb3NpdG9yeVVyaSA9IG1haWxFeGFtcGxlUmVwb3NpdG9yeS5hdHRyUmVwb3NpdG9yeVVyaTtcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDZm5PdXRwdXRSZXBvc2l0b3J5VXJpJywge1xyXG4gICAgICBrZXk6ICdSZXBvc2l0b3J5VXJpJyxcclxuICAgICAgdmFsdWU6IHRoaXMucmVwb3NpdG9yeVVyaS50b1N0cmluZygpLFxyXG4gICAgfSk7XHJcbiAgICB0aGlzLmFwaUludm9rZVVybCA9IGJhc2VVcmwudG9TdHJpbmcoKTtcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDZm5PdXRwdXRBcGlJbnZva2VVcmwnLCB7XHJcbiAgICAgIGtleTogJ0FwaUludm9rZVVybCcsXHJcbiAgICAgIHZhbHVlOiB0aGlzLmFwaUludm9rZVVybCxcclxuICAgIH0pO1xyXG4gICAgdGhpcy5jbG91ZE1hcFNlcnZpY2VBcm4gPSBhcHBDbG91ZE1hcFNlcnZpY2UuYXR0ckFybjtcclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDZm5PdXRwdXRDbG91ZE1hcFNlcnZpY2VBcm4nLCB7XHJcbiAgICAgIGtleTogJ0Nsb3VkTWFwU2VydmljZUFybicsXHJcbiAgICAgIHZhbHVlOiB0aGlzLmNsb3VkTWFwU2VydmljZUFybi50b1N0cmluZygpLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59XHJcbiJdfQ==