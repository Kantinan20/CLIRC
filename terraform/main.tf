terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

# S3 bucket used by the report-uploader app to store generated reports
resource "aws_s3_bucket" "report_uploads" {
  bucket = "clirc-demo-report-uploads"
}

# IAM role assumed by the report-uploader application (EC2/ECS task role)
resource "aws_iam_role" "report_uploader_role" {
  name = "report-uploader-app-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

# Policy granting the app permission to read AND write report objects
resource "aws_iam_role_policy" "report_uploader_s3_policy" {
  name = "report-uploader-s3-access"
  role = aws_iam_role.report_uploader_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowReportBucketReadWrite"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.report_uploads.arn,
          "${aws_s3_bucket.report_uploads.arn}/*"
        ]
      }
    ]
  })
}
