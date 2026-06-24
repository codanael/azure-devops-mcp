# Frequently Asked Questions

Before you get started, ensure you follow the steps in the `README.md` file. This will help you get up and running and connected to your Azure DevOps organization.

## Does the MCP Server support both Azure DevOps Services and on-premises deployments?

Azure DevOps Services (cloud) is fully supported. **Azure DevOps Server (on-premises) 2022 is supported** with the following setup and limitations:

- Pass the full collection URL instead of an organization name, e.g. `mcp-server-azuredevops https://tfs.contoso.com/DefaultCollection`.
- Authentication is **PAT only** — set `--authentication pat` (implied automatically when a URL is given) and the `PERSONAL_ACCESS_TOKEN` environment variable to a base64-encoded `<email>:<pat>` value. Microsoft Entra sign-in (`interactive`/`azcli`/`env`) is not available on-prem.
- The REST API version defaults to `7.0` (Azure DevOps Server 2022). Override with `--api-version 7.1` (Server 2022.1) or `6.0` (Server 2020).
- **Advanced Security** tools are disabled on-prem (cloud-only product).
- **Code Search** requires the Search extension installed on the target collection.
- **Markdown** work item comments fall back to the server default format on-prem.
- Windows Integrated Auth (NTLM/Kerberos) is not supported; a PAT is required.

## Can I connect to more than one organization at a time?

No, you can connect to only one organization at a time. However, you can switch organizations as needed.

## Can I set a default project instead of fetching the list every time?

Currently, you need to fetch the list of projects so the LLM has context about the project name or ID. We plan to improve this experience in the future by leveraging prompts. In the meantime, you can set a default project name in your `copilot-instructions.md` file.

## Are PAT's supported?

Yes! Personal Access Tokens (PATs) are supported via the `pat` authentication type. See the [Authentication Methods](./GETTINGSTARTED.md#-authentication-methods) section in the Getting Started guide for setup instructions, including the required base64 encoding format.

## Is there a remote supported version of the MCP Server?

At this time, only the local version of the MCP Server is supported.

## Are personal accounts supported?

Unfortunately, personal accounts are not supported. To maintain a higher level of authentication and security, your account must be backed by Entra ID. If you receive an error message like this, it means you are using a personal account.

![image of login error for personal accounts](./media/personal-accounts-error.png)

## When will a remote Azure DevOps MCP Server be available?

We receive this question frequently. The good news is that work is currently underway. Development began in early January 2026. Once we can provide a reliable timeline, we will publish it on the public [Azure DevOps roadmap](https://learn.microsoft.com/en-us/azure/devops/release-notes/features-timeline).
