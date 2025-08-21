#!/usr/bin/env node

import { InputError, main } from "./main.js"

const {
  OUTPUT_DIR: outputDir,
  EVENTS_DIR: eventsDir,
  TEMPLATE_PATH: templateYamlPath,
} = process.env

main({ outputDir, eventsDir, templateYamlPath }).catch((error) => {
  if (error instanceof InputError) {
    console.error(error.message)
  } else {
    console.error(error)
  }
})
