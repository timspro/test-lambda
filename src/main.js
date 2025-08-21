import { mkdir, readFile, readdir } from "node:fs/promises"
import { basename, extname } from "node:path"
import YAML from "yaml"
import { runLambda } from "./run-lambda.js"

export class InputError extends Error {}

/**
 * Run the lambdas given certain information about where to get inputs and put output.
 * @param {Object} $1
 * @param {Array<string>} $1.argv process.argv
 * @param {string} $1.outputDir specifies where to put the responses of each lambda invocation. Makes this directory recursively if needed.
 * @param {string} $1.eventsDir specifies a directory of JSON files. Each JSON file name should correspond to the end of a CodeURI in template.yaml
 *  For example, if EVENTS_DIR contained a JSON file called "query.json" and template.yaml contained "CodeUri: dist/users-query",
 *  then the script will associate calling that lambda with the event in the JSON file.
 *  Be careful that only one CodeUri matches for each JSON file (no same name but different directory support).
 * @param {string} $1.templateYamlPath specifies the path to find the template.yaml file.
 * @param {string=} $1.stackName specifies a prefix to the function name,
 *  which is used when looking up the deployed lambda using the function name written in template.yaml
 */
export async function main({ argv, outputDir, eventsDir, templateYamlPath, stackName }) {
  const mode = argv[2]
  if (mode !== "remote" && mode !== "local") {
    throw new InputError("second argument must be 'remote' or 'local'")
  }
  await mkdir(outputDir, { recursive: true })

  let lambdaFilenames = (await readdir(eventsDir)).map((lambdaFilename) => {
    const lambda = basename(lambdaFilename, extname(lambdaFilename))
    return lambda
  })
  const filter = argv[3]
  if (filter) {
    lambdaFilenames = lambdaFilenames.filter((lambda) => lambda === filter)
  }
  const document = YAML.parse((await readFile(templateYamlPath)).toString(), {
    logLevel: "silent",
  })
  const promises = lambdaFilenames.map((lambdaFilename) => {
    const lambda = basename(lambdaFilename, extname(lambdaFilename))
    return runLambda({
      outputDir,
      eventsDir,
      document,
      lambda,
      mode,
      stackName,
      filtered: Boolean(filter),
    })
  })
  if (!promises.length) {
    throw new InputError(`no lambdas specified; args: ${argv.slice(2).join(" ")}`)
  }
  await Promise.allSettled(promises)
}
