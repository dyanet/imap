#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { GmailViewerCdkStack } from '../lib/gmail-viewer-cdk-stack';

const app = new App();

// To specify subnets, use the --context option with a comma-separated list of subnet IDs:
// cdk deploy -c privateSubnets=subnet-xxxxxxxx,subnet-yyyyyyyy
const privateSubnets = app.node.tryGetContext('privateSubnets')?.split(',');

new GmailViewerCdkStack(app, 'GmailViewerCdkStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  privateSubnets: ['subnet-0d8290d0ea575331c', 'subnet-032290569a7ecf210'],
  publicSubnets: ['subnet-0713ade30dd8c308c', 'subnet-0b4dd45b51bb8252f'],
  gitHubOwner: 'dyanet',
  gitHubRepo: 'imap',
  gitHubBranch: 'main',
  codeConnectionArn: 'arn:aws:codeconnections:ca-central-1:239030031457:connection/29fe5c11-23d2-4c10-a81d-4e880b12e2c6',
  useGitHubWebhooks: false,
  apiCustomDomainName: 'demo.dyanet.com',
  certificateArn: 'arn:aws:acm:ca-central-1:239030031457:certificate/cb01610f-dddd-44e1-abd9-0672f0dc3355',
});
