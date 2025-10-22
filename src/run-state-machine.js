import { sleep } from "@tim-code/my-util"
import { execSync } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { resolvePhysicalId } from "./util.js"
/**
 * Start execution for a state machine using the AWS CLI.
 * @param {Object} $1
 * @param {string} $1.stateMachineArn ARN of the Step Function state machine
 * @param {string} $1.eventName Execution name
 * @param {string} $1.inputPath Path to the input event JSON
 * @param {string} $1.outputPath Path to write the output
 * @returns {string} Execution ARN
 */
function startExecutionCLI({ stateMachineArn, eventName, inputPath }) {
  const executionName = `${eventName}-${Date.now()}`
  const args = [
    "aws",
    "stepfunctions",
    "start-execution",
    "--state-machine-arn",
    stateMachineArn,
    "--name",
    executionName,
    "--input",
    `file://${inputPath}`,
    "--query",
    "executionArn",
    "--output",
    "text",
  ]
  console.log(`starting execution: ${executionName}`)
  const executionArn = execSync(args.join(" "), { encoding: "utf-8" }).trim()
  if (!executionArn) {
    throw new Error("could not start execution")
  }

  console.log(`execution ARN: ${executionArn}`)
  return executionArn
}

/**
 * Describe execution status for a state machine using AWS CLI.
 * @param {Object} $1
 * @param {string} $1.executionArn Execution ARN
 * @returns {string} Execution status
 */
function describeStatusCLI({ executionArn }) {
  const args = [
    "aws",
    "stepfunctions",
    "describe-execution",
    "--execution-arn",
    executionArn,
    "--query",
    "status",
    "--output",
    "text",
  ]
  return execSync(args.join(" "), { encoding: "utf-8" }).trim()
}

/**
 * Fetch the output of the execution of a state machine from AWS CLI.
 * @param {Object} $1
 * @param {string} $1.executionArn Execution ARN
 * @returns {string} Execution output
 */
function fetchOutputCLI({ executionArn }) {
  const args = [
    "aws",
    "stepfunctions",
    "describe-execution",
    "--execution-arn",
    executionArn,
    "--query",
    "output",
    "--output",
    "text",
  ]
  const output = execSync(args.join(" "), { encoding: "utf-8" }).trim()
  if (output && output !== "None") {
    return output
  }
  return ""
}

/**
 * Run a state machine using AWS CLI.
 * @param {Object} $1
 * @param {string} $1.inputPath Path to input event file
 * @param {string} $1.outputPath Path to output file
 * @param {string} $1.logicalId Logical ID of the Step Function (CloudFormation)
 * @param {string} $1.eventName Name of the event
 * @param {string} $1.stackName CloudFormation stack name
 * @returns {Promise<Object>} Result of execution
 */
export async function runStateMachine({
  inputPath,
  outputPath,
  logicalId,
  eventName,
  stackName,
  filtered,
}) {
  // resolve the physical ID (state machine ARN) from CloudFormation Logical ID
  const stateMachineArn = resolvePhysicalId({ logicalId, stackName })
  const executionArn = startExecutionCLI({
    stateMachineArn,
    eventName,
    inputPath,
  })
  // poll the execution status every 5 seconds until it's finished
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const status = describeStatusCLI({ executionArn })
    if (status !== "RUNNING") {
      const output = fetchOutputCLI({ executionArn })
      await writeFile(outputPath, output)
      if (filtered) {
        console.log(output)
      }
      return { status, output, executionArn }
    }
    await sleep(5000)
  }
}
