# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting: open the **Security** tab of this repository and choose **Report a vulnerability**.

Include what you found, how to reproduce it, and the version or commit affected. You will get an answer as soon as a maintainer can read the report. After a fix ships, the advisory is published and credits you if you wish.

## Supported versions

Nothing has been released yet, and the project is pre-1.0. Once a release exists, only the latest release receives security fixes.

## Secrets

This tool uses an OpenRouter API key and Langfuse keys. Keep them in your environment or in a local `.env` file, which Git ignores. Never paste keys into issues, pull requests or logs. If a key leaks, revoke it at the provider first.
