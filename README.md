# test-lambda

A script to test a "local" (via Docker) or "remote" lambda with as little configuration as possible.

## Setup

`npm install @tim-code/test-lambda`

## Running

`test-lambda local|remote [<search-string>]`

where "search-string" is an optional filename in the events directory without ".json" extension, which will be run instead of all lambdas.

### Environment Variables

OUTPUT_DIR specifies where to put the responses of each lambda invocation. Makes this directory recursively if needed.

EVENTS_DIR specifies a directory of JSON files. Each JSON file name should correspond to the end of a CodeURI in template.yaml. For example, if EVENTS_DIR contained a JSON file called "query.json" and template.yaml contained "CodeUri: dist/options-query", then the script will associate calling that lambda with the event in the JSON file. Be careful that only one CodeUri matches for each JSON file (no same name but different directory support).

TEMPLATE_PATH specifies the path to find the template.yaml file.

STACK_NAME specifies a prefix to the function name, which is used when looking up the deployed lambda using the function name written in template.yaml.

USE_PACKAGE_NAME: if true and STACK_NAME is not defined, uses the npm_package_name environment variable defined by npm instead of STACK_NAME. This works when your package's name is your stack's name. Default is true.
