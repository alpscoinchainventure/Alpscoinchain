# AlpsCoinChain X Auto-Posting Bot

This folder contains a minimal GitHub Actions scheduler that publishes one short educational/company-update post per run to the X account authorized by the token.

## Schedule

The workflow is scheduled for 08:00, 13:00, and 18:00 UTC daily. GitHub scheduled jobs can start late. You can also run it manually with **Actions → AlpsCoinChain X Auto-Posting → Run workflow** after the workflow is enabled on the repository's default branch.

## Required secret

Add a repository Actions secret named `X_USER_ACCESS_TOKEN`. Its value must be the OAuth 2.0 **user access token** generated after authorizing the AlpsCoinChain X account, with at least `tweet.write`, `tweet.read`, and `users.read` scopes. Do not use the app-only bearer token. Never commit tokens or paste them into issues or chat.

## Important activation note

GitHub scheduled workflows run from the repository's **default branch**. These files must be reviewed and merged into the default branch before the schedule becomes active. Keep this setup isolated from the live AlpsCoinChain website until you intentionally decide how to organize the repository.

## What it does / does not do

- Publishes one prewritten short post per run.
- Uses X API v2 and reports the post ID in the workflow log.
- Does not send direct messages, follow accounts, or automatically reply to other users.
- Posts are educational and avoid promises of returns. Review the content and ensure it accurately represents the business before enabling.
- X API usage may incur charges. Check current pricing and your billing limits before running the workflow.
