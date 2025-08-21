import { alert, allSettled } from "@tim-code/my-util"
import { execSync, spawn } from "node:child_process"
import { open, readFile, readdir } from "node:fs/promises"
import { basename, extname } from "node:path"
import { exit } from "node:process"
import YAML from "yaml"

/**
 * OUTPUT_DIR specifies where to put the responses of each lambda invocation.
 * EVENTS_DIR specifies a directory of JSON files. Each JSON file name should correspond to the end of a CodeURI in template.yaml
 *  For example, if EVENTS_DIR contained a JSON file called "query.json" and template.yaml contained "CodeUri: dist/options-query",
 *  then the script will associate calling that lambda with the event in the JSON file. Be careful that only one CodeUri matches for each JSON file.
 * TEMPLATE_PATH specifies the path to find the template.yaml file.
 */
const {
  OUTPUT_DIR: outputDir,
  EVENTS_DIR: eventsDir,
  TEMPLATE_PATH: templateYamlPath,
} = process.env

export function findFunctionName(object, codeUri, parents = []) {
  if (object && typeof object === "object") {
    for (const [key, value] of Object.entries(object)) {
      if (key === "CodeUri") {
        if (value.endsWith(codeUri)) {
          // parents should be FunctionName then Properties
          return parents[parents.length - 2]
        }
      }
      const result = findFunctionName(value, codeUri, [...parents, key])
      if (result) {
        return result
      }
    }
  }
  return undefined
}

export function resolveFunctionName(prefix) {
  prefix = `${process.env.npm_package_name}-${prefix}`
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

export async function runTest({ document, lambda, mode, filtered }) {
  const inputPath = `${eventsDir}/${lambda}.json`
  const stdoutPath = `${outputDir}/${lambda}.json`

  const functionName = findFunctionName(document, lambda)
  if (!functionName) {
    console.log(`could not find function name for ${lambda}`)
    return undefined
  }

  let command, args, stdoutFd
  if (mode === "local") {
    command = "sam"
    args = ["local", "invoke", functionName, "--event", inputPath]
    stdoutFd = await open(stdoutPath, "w")
  } else {
    // does make more sense to use `sam remote invoke` but cannot specify boto config when using that
    // this results in the CLI timing out when invoking a lambda that lasts more than 10 seconds
    command = "aws"
    const actualFunctionName = resolveFunctionName(functionName)
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
      stdoutPath,
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

      const buffer = await readFile(stdoutPath)
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

export async function main() {
  const mode = process.argv[2]
  if (mode !== "remote" && mode !== "local") {
    console.log("second argument must be 'remote' or 'local'")
    exit()
  }
  let lambdaFilenames = (await readdir(eventsDir)).map((lambdaFilename) => {
    const lambda = basename(lambdaFilename, extname(lambdaFilename))
    return lambda
  })
  const filter = process.argv[3]
  if (filter) {
    lambdaFilenames = lambdaFilenames.filter((lambda) => lambda === filter)
  }
  const document = YAML.parse((await readFile(templateYamlPath)).toString(), {
    logLevel: "silent",
  })
  const promises = lambdaFilenames.map((lambdaFilename) => {
    const lambda = basename(lambdaFilename, extname(lambdaFilename))
    return runTest({ document, lambda, mode, filtered: Boolean(filter) })
  })
  if (!promises.length) {
    console.error(`no lambdas specified; args: ${process.argv.slice(2).join(" ")}`)
  }
  alert(await allSettled(promises))
}
