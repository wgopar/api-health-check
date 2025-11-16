#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: build_and_push_ecr.sh --account AWS_ACCOUNT_ID [--repo REPO_NAME] [--region AWS_REGION]

Environment variables:
  AWS_REGION - defaults to us-west-2 when not provided.

The script builds the Docker image in the repo root, logs into ECR, ensures the
repository exists, tags the image, and pushes it. It prints the full image URI
for use in terraform tfvars.
EOF
}

REPO_NAME="api-health-check"
DEFAULT_TAG="$(node -p "require('./package.json').version" 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || date +%s)"
AWS_REGION="${AWS_REGION:-us-west-2}"
AWS_ACCOUNT_ID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO_NAME="$2"
      shift 2
      ;;
    --tag)
      IMAGE_TAG="$2"
      shift 2
      ;;
    --region)
      AWS_REGION="$2"
      shift 2
      ;;
    --account)
      AWS_ACCOUNT_ID="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

IMAGE_TAG="${IMAGE_TAG:-$DEFAULT_TAG}"

if [[ -z "${AWS_ACCOUNT_ID}" ]]; then
  echo "--account AWS_ACCOUNT_ID is required." >&2
  exit 1
fi

ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
IMAGE_URI="${ECR_URI}/${REPO_NAME}:${IMAGE_TAG}"

echo ">> Ensuring ECR repository ${REPO_NAME} exists..."
if ! aws ecr describe-repositories --repository-names "${REPO_NAME}" --region "${AWS_REGION}" >/dev/null 2>&1; then
  aws ecr create-repository --repository-name "${REPO_NAME}" --image-scanning-configuration scanOnPush=true --region "${AWS_REGION}" >/dev/null
fi

echo ">> Logging into ECR ${ECR_URI}..."
aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${ECR_URI}"

echo ">> Building Docker image ${IMAGE_URI} for linux/amd64..."
docker buildx build --platform linux/amd64 -t "${IMAGE_URI}" .

echo ">> Pushing ${IMAGE_URI}..."
docker push "${IMAGE_URI}"

echo "Image pushed: ${IMAGE_URI}"
echo "Use this value for terraform container_image."
