import { execSync } from "node:child_process"

/**
 * Gets the physical ID for a resource given the logical ID and stack name.
 * @param {Object} $1
 * @param {string} $1.logicalId
 * @param {string} $1.stackName
 * @returns {string}
 */
export function resolvePhysicalId({ logicalId, stackName }) {
  const escapedStackName = JSON.stringify(stackName)
  const output = execSync(
    `aws cloudformation list-stack-resources \
       --stack-name ${escapedStackName} \
       --query "StackResourceSummaries[?LogicalResourceId=='${logicalId}'].PhysicalResourceId | [0]" \
       --output text`,
    { encoding: "utf-8" }
  ).trim()
  if (!output || output === "None") {
    throw new Error(`no physical ID found for logical ID: ${logicalId}`)
  }
  return output
}
