# Gmail Viewer CDK

Quick notes for the `examples/gmail-viewer-cdk` stack.

## Defaults and guesses
- Defaults to the account's default VPC when no `vpcId` is provided and picks private subnets (or public if none exist).
- Container defaults: port 3000, 0.5 vCPU (512 CPU units), 1024 MB memory, desired count 1, service discovery TTL 30 seconds, SSM prefix `/mail-example`.
- GitHub settings are auto-guessed from `GITHUB_REPOSITORY`/`GITHUB_REF_NAME` (falling back to `dyanet/imap` and `main`).
- Custom domain is optional. Provide `CERTIFICATE_ARN` (or context `certificateArn`) and `API_CUSTOM_DOMAIN` to enable the HTTPS domain and Route53 record; otherwise the HTTP API endpoint + stage path is used.

## CodeBuild
- Service role now includes log publishing, ECR push, ECS deploy, and SSM read permissions needed by the buildspec.
- Build badge and GitHub webhook are enabled; webhook filters to the configured branch.
- Inline buildspec logs into ECR, builds + tags the image, pushes both tags, and forces an ECS service deploy.

## GitHub Actions trigger
- Workflow `.github/workflows/mail-example-runner-webhook.yml` now runs on pushes to `main`, manual dispatch, or `repository_dispatch` events.
- If secrets `CODEBUILD_WEBHOOK_URL` (and optional `CODEBUILD_WEBHOOK_TOKEN`) are set, the workflow posts to the CodeBuild webhook; it always falls back to `aws codebuild start-build` using the current SHA/branch.
- Repository dispatch can be fired with `gh api repos/$OWNER/$REPO/dispatches -f event_type=runner-webhook -f client_payload[sha]=$(git rev-parse HEAD) -f client_payload[branch]=main`.
