import { execSync, spawn } from "node:child_process"
import { open, readFile } from "node:fs/promises"

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
       --query "StackResourceSummaries[?LogicalResourceId=='${logicalId}' && ResourceType=='AWS::Lambda::Function'].PhysicalResourceId | [0]" \
       --output text`,
    { encoding: "utf-8" }
  ).trim()
  if (!output || output === "None") {
    throw new Error(`no physical ID found for logical ID: ${logicalId}`)
  }
  return output
}

/**
 * Run a lambda using AWS CLI.
 * @param {Object} $1
 * @param {string} $1.inputPath Path to input event file
 * @param {string} $1.outputPath Path to output file
 * @param {string} $1.logicalId Logical ID of the lambda (CloudFormation)
 * @param {string} $1.eventName Name of the event
 * @param {string} $1.mode "local" or "remote"
 * @param {string} $1.stackName CloudFormation stack name
 * @param {boolean} $1.filtered If true, will console.log output.
 */
export async function runLambda({
  inputPath,
  outputPath,
  logicalId,
  eventName,
  mode,
  stackName,
  filtered,
}) {
  let command, args, stdoutFd
  if (mode === "local") {
    command = "sam"
    args = ["local", "invoke", logicalId, "--event", inputPath]
    stdoutFd = await open(outputPath, "w")
  } else {
    // does make more sense to use `sam remote invoke` but cannot specify boto config when using that
    // this results in the CLI timing out when invoking a lambda that lasts more than 10 seconds
    command = "aws"
    const actualFunctionName = resolvePhysicalId({ logicalId, stackName })
    const payloadPath = `file://${inputPath}`
    args = [
      "lambda",
      "invoke",
      "--function-name",
      actualFunctionName,
      "--payload",
      payloadPath,
      "--cli-binary-format",
      "raw-in-base64-out",
      "--cli-read-timeout",
      "0", // "If the value is set to 0, the socket read will be blocking and not timeout"
      outputPath,
    ]
    stdoutFd = { fd: "ignore", close: () => {} }
  }
  console.log(`command: ${command} ${args.join(" ")}`)
  const subprocess = spawn(command, args, {
    stdio: ["inherit", stdoutFd.fd, "inherit"],
  })

  // unclear when this has effect
  subprocess.on("error", console.error)

  return new Promise((resolve) => {
    subprocess.on("close", async (code) => {
      await stdoutFd.close()

      if (code !== 0) {
        console.log(`💥 ${eventName} exited with code ${code}`)
        resolve()
        return
      }

      const buffer = await readFile(outputPath)
      if (!buffer || !buffer.length) {
        console.log(`❌ ${eventName} - empty response`)
        resolve()
        return
      }
      // assumes that lambda returns JSON with "statusCode" key; may need to revisit later
      const result = JSON.parse(buffer.toString())
      if (
        result.statusCode === 200 &&
        !result?.errors?.length &&
        !result?.body?.errors?.length
      ) {
        console.log(`✅ ${eventName}`)
      } else {
        console.log(`❌ ${eventName}`)
      }
      if (filtered) {
        console.log(result)
      }
      resolve()
    })
  })
}
