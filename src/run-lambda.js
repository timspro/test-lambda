import { execSync, spawn } from "node:child_process"
import { open, readFile } from "node:fs/promises"

export function findFunctionLogicalId(document, codeUriSuffix, parents = []) {
  if (document && typeof document === "object") {
    for (const [key, value] of Object.entries(document)) {
      if (key === "CodeUri") {
        if (value.endsWith(codeUriSuffix)) {
          // parents should be FunctionName then Properties
          return parents[parents.length - 2]
        }
      }
      const result = findFunctionLogicalId(value, codeUriSuffix, [...parents, key])
      if (result) {
        return result
      }
    }
  }
  return undefined
}

export function resolveFunctionName(prefix, { stackName } = {}) {
  if (stackName) {
    prefix = `${stackName}-${prefix}`
  }
  try {
    const output = execSync(
      `aws lambda list-functions --query "Functions[?starts_with(FunctionName, '${prefix}')].FunctionName | [0]" --output text`,
      { encoding: "utf-8" }
    ).trim()
    if (!output || output === "None") {
      throw new Error(`No function found with prefix: ${prefix}`)
    }
    return output
  } catch (err) {
    throw new Error(`Failed to resolve function: ${err.message}`)
  }
}

export async function runLambda({
  eventsDir,
  outputDir,
  document,
  lambda,
  mode,
  stackName,
  filtered,
}) {
  const inputPath = `${eventsDir}/${lambda}.json`
  const outputPath = `${outputDir}/${lambda}.json`

  const functionLogicalId = findFunctionLogicalId(document, lambda)
  if (!functionLogicalId) {
    console.log(`could not find function name for ${lambda}`)
    return undefined
  }

  let command, args, stdoutFd
  if (mode === "local") {
    command = "sam"
    args = ["local", "invoke", functionLogicalId, "--event", inputPath]
    stdoutFd = await open(outputPath, "w")
  } else {
    // does make more sense to use `sam remote invoke` but cannot specify boto config when using that
    // this results in the CLI timing out when invoking a lambda that lasts more than 10 seconds
    command = "aws"
    const actualFunctionName = resolveFunctionName(functionLogicalId, { stackName })
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
        console.log(`💥 ${lambda} exited with code ${code}`)
        resolve()
        return
      }

      const buffer = await readFile(outputPath)
      if (!buffer || !buffer.length) {
        console.log(`❌ ${lambda} - empty response`)
        resolve()
        return
      }
      const result = JSON.parse(buffer.toString())
      const body = JSON.parse(result.body ?? "{}")
      if (
        result.statusCode === 200 &&
        (!result.errors || !body.errors || !body.errors.length)
      ) {
        console.log(`✅ ${lambda}`)
      } else {
        console.log(`❌ ${lambda}`)
      }
      if (filtered) {
        console.log(result)
      }
      resolve()
    })
  })
}
