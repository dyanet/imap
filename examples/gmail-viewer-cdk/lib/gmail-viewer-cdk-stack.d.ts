import * as cdk from 'aws-cdk-lib';
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
export declare class GmailViewerCdkStack extends cdk.Stack {
    readonly clusterName: string;
    readonly repositoryUri: string;
    readonly apiInvokeUrl: string;
    readonly cloudMapServiceArn: string;
    constructor(scope: cdk.App, id: string, props: GmailViewerCdkStackProps);
}
