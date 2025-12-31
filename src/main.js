import { allSettled } from "@tim-code/my-util"
import { mkdir, readFile, readdir } from "node:fs/promises"
import { basename, extname } from "node:path"
import YAML from "yaml"
import { runLambda } from "./run-lambda.js"
import { runStateMachine } from "./run-state-machine.js"

export class InputError extends Error {}

/**
 * Gets the top-level definition from the template.yaml for a logical ID.
 * @param {Object} document Parsed template.yaml
 * @param {string} logicalId
 * @returns {Object|undefined}
 */
export function getDefinition(document, logicalId) {
  const result = document?.Resources?.[logicalId]
  return result
}

/**
 * Gets a function's logical ID given part of the code URI.
 * @param {Object} document Parsed template.yaml
 * @param {string} codeUriSuffix
 * @param {Array=} parents Used for recursion
 * @returns {string|undefined}
 */
export function findFunctionLogicalId(document, codeUriSuffix, parents = []) {
  // base case for recursion
  if (!document || typeof document !== "object") {
    return undefined
  }
  for (const [key, value] of Object.entries(document)) {
    if (key === "CodeUri") {
      if (value?.endsWith?.(codeUriSuffix)) {
        // parents should be: [..., FunctionName, "Properties"]
        return parents[parents.length - 2]
      }
    }
    const result = findFunctionLogicalId(value, codeUriSuffix, [...parents, key])
    if (result) {
      return result
    }
  }
  return undefined
}

/**
 * Run the lambdas and state machines given certain information about where to get inputs and put output.
 * @param {Object} $1
 * @param {Array<string>} $1.argv process.argv
 * @param {string} $1.outputDir Specifies where to put the responses of each lambda invocation.
 *  Makes this directory recursively if needed.
 * @param {string} $1.eventsDir Specifies a directory of JSON files.
 *  Each JSON file name should correspond either to a logical ID ("Resources" key) OR to the end of a CodeURI in template.yaml
 *  For example, if EVENTS_DIR contained a JSON file called "query.json" and template.yaml contained "CodeUri: dist/users-query",
 *    then the script will associate calling that lambda with the event in the JSON file.
 *  Be careful that only one CodeUri matches for each JSON file (no same name but different directory support).
 * @param {string} $1.templateYamlPath Specifies the path to find the template.yaml file.
 * @param {string=} $1.stackName Specifies the stack name of the deployment.
 *  It is used to determine physical ID for remote resources from the logical ID.
 */
export async function main({ argv, outputDir, eventsDir, templateYamlPath, stackName }) {
  const mode = argv[2]
  if (mode !== "remote" && mode !== "local") {
    throw new InputError("second argument must be 'remote' or 'local'")
  }
  await mkdir(outputDir, { recursive: true })

  let eventNames = (await readdir(eventsDir)).map((eventFilename) => {
    const eventName = basename(eventFilename, extname(eventFilename))
    return eventName
  })
  const filter = argv[3]
  if (filter) {
    eventNames = eventNames.filter((eventName) => eventName === filter)
  }
  if (!eventNames.length) {
    throw new InputError("no events specified")
  }
  const document = YAML.parse((await readFile(templateYamlPath)).toString(), {
    logLevel: "silent",
  })

  const filtered = Boolean(filter)
  const promises = eventNames
    .map((eventName) => {
      let logicalId
      if (getDefinition(document, eventName)) {
        logicalId = eventName
      } else {
        // allow "CodeUri" lookup as well
        logicalId = findFunctionLogicalId(document, eventName)
      }
      if (!logicalId) {
        console.error(`could not find logical id for ${eventName}`)
        return undefined
      }
      const inputPath = `${eventsDir}/${eventName}.json`
      const outputPath = `${outputDir}/${eventName}.json`
      const { Type: type } = getDefinition(document, logicalId)
      if (type === "AWS::Serverless::Function") {
        return runLambda({
          inputPath,
          outputPath,
          logicalId,
          eventName,
          mode,
          stackName,
          filtered,
        })
      } else if (type === "AWS::Serverless::StateMachine") {
        if (mode === "remote") {
          return runStateMachine({
            inputPath,
            outputPath,
            logicalId,
            eventName,
            stackName,
            filtered,
          })
        }
        if (filtered) {
          console.log('state machines must be run with mode "remote"')
        }
        return undefined
      }
      console.error(`unknown type ${type} for ${eventName}`)
      return undefined
    })
    .filter((_) => _)

  if (!promises.length) {
    throw new InputError("no lambdas or state machines specified")
  }
  const { errors } = await allSettled({ array: promises })
  if (errors.length) {
    console.error(...errors.map((_) => _.message))
  }
}
