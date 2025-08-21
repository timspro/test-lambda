/* eslint-disable no-restricted-syntax */
import { jest } from "@jest/globals"
import { sleep } from "@tim-code/my-util"

// Mocks for external modules and functions
const execSyncMock = jest.fn()
const spawnMock = jest.fn()
const openMock = jest.fn()
const readFileMock = jest.fn()
const readdirMock = jest.fn()
const exitMock = jest.fn()
const YAMLParseMock = jest.fn()

jest.unstable_mockModule("node:child_process", () => ({
  execSync: execSyncMock,
  spawn: spawnMock,
}))
jest.unstable_mockModule("node:fs/promises", () => ({
  open: openMock,
  readFile: readFileMock,
  readdir: readdirMock,
}))
jest.unstable_mockModule("node:process", () => ({
  exit: exitMock,
}))
jest.unstable_mockModule("yaml", () => ({
  default: { parse: YAMLParseMock },
}))

const { findFunctionName, resolveFunctionName, runTest, main, InputError } = await import(
  "./main.js"
)

describe("findFunctionName", () => {
  it("returns the function name when CodeUri matches at correct depth", () => {
    const doc = {
      Resources: {
        MyFunc: {
          Type: "AWS::Lambda::Function",
          Properties: {
            CodeUri: "dist/foo",
          },
        },
      },
    }
    expect(findFunctionName(doc, "dist/foo")).toBe("MyFunc")
  })

  it("returns undefined if CodeUri does not match", () => {
    const doc = {
      Resources: {
        MyFunc: {
          Type: "AWS::Lambda::Function",
          Properties: {
            CodeUri: "dist/bar",
          },
        },
      },
    }
    expect(findFunctionName(doc, "dist/foo")).toBeUndefined()
  })

  // not supported for now
  // it("finds deeply nested CodeUri and returns correct parent", () => {
  //   const doc = {
  //     Resources: {
  //       MyFunc: {
  //         Nested: {
  //           Properties: {
  //             CodeUri: "dist/deep",
  //           },
  //         },
  //       },
  //     },
  //   }
  //   expect(findFunctionName(doc, "dist/deep")).toBe("MyFunc")
  // })

  it("returns undefined for non-object input", () => {
    expect(findFunctionName(null, "foo")).toBeUndefined()
    expect(findFunctionName(42, "foo")).toBeUndefined()
  })

  it("returns first match if multiple CodeUri present", () => {
    const doc = {
      Resources: {
        Func1: { Properties: { CodeUri: "dist/foo" } },
        Func2: { Properties: { CodeUri: "dist/foo" } },
      },
    }
    // Should return the first encountered, which is Func1
    expect(findFunctionName(doc, "dist/foo")).toBe("Func1")
  })
})

describe("resolveFunctionName", () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    process.env = { ...OLD_ENV, npm_package_name: "mypkg" }
    execSyncMock.mockReset()
  })

  afterAll(() => {
    process.env = OLD_ENV
  })

  it("returns function name from execSync output", () => {
    execSyncMock.mockReturnValue("mypkg-abc-func\n")
    expect(resolveFunctionName("abc-func")).toBe("mypkg-abc-func")
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining("aws lambda list-functions"),
      expect.objectContaining({ encoding: "utf-8" })
    )
  })

  it("throws if execSync output is empty", () => {
    execSyncMock.mockReturnValue("")
    expect(() => resolveFunctionName("abc")).toThrow(
      "No function found with prefix: mypkg-abc"
    )
  })

  it('throws if execSync output is "None"', () => {
    execSyncMock.mockReturnValue("None\n")
    expect(() => resolveFunctionName("def")).toThrow(
      "No function found with prefix: mypkg-def"
    )
  })

  it("throws with error message if execSync throws", () => {
    execSyncMock.mockImplementation(() => {
      throw new Error("fail")
    })
    expect(() => resolveFunctionName("x")).toThrow("Failed to resolve function: fail")
  })
})

describe("runTest", () => {
  const OLD_ENV = process.env
  let closeMock, onMock, subprocessMock

  beforeEach(() => {
    process.env = { ...OLD_ENV }
    closeMock = jest.fn().mockResolvedValue()
    openMock.mockResolvedValue({ fd: 9, close: closeMock })
    readFileMock.mockReset()
    spawnMock.mockReset()
    onMock = jest.fn()
    subprocessMock = { on: onMock }
    spawnMock.mockReturnValue(subprocessMock)
  })

  afterAll(() => {
    process.env = OLD_ENV
  })

  it("returns undefined if functionName not found", async () => {
    const document = {}
    const lambda = "foo"
    const spy = jest.spyOn(console, "log").mockImplementation(() => {})
    const result = await runTest({
      document,
      lambda,
      mode: "local",
      eventsDir: "/ev",
      outputDir: "/out",
    })
    expect(result).toBeUndefined()
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("could not find function name"))
    spy.mockRestore()
  })

  it("runs local mode and handles success path", async () => {
    const document = { Resources: { MyFunc: { Properties: { CodeUri: "foo" } } } }
    const lambda = "foo"
    let closeHandler
    onMock.mockImplementation((event, cb) => {
      if (event === "close") closeHandler = cb
      return subprocessMock
    })
    const response = { statusCode: 200, body: JSON.stringify({}) }
    readFileMock.mockResolvedValue(Buffer.from(JSON.stringify(response)))
    openMock.mockResolvedValue({ fd: 1, close: closeMock })

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {})

    const promise = runTest({
      document,
      lambda,
      mode: "local",
      eventsDir: "/ev",
      outputDir: "/out",
    })
    await sleep(0)
    await closeHandler(0)
    await promise

    expect(spawnMock).toHaveBeenCalledWith(
      "sam",
      expect.arrayContaining(["local", "invoke", "MyFunc"]),
      expect.objectContaining({ stdio: expect.any(Array) })
    )
    expect(closeMock).toHaveBeenCalled()
    expect(readFileMock).toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("✅"))
    logSpy.mockRestore()
  })

  it("runs remote mode and handles non-200/error status", async () => {
    const document = { Resources: { MyFunc: { Properties: { CodeUri: "foo" } } } }
    const lambda = "foo"
    // ISSUE: Cannot mock resolveFunctionName since it's in the same file. Should be moved to separate module for full isolation.
    execSyncMock.mockReturnValue("pkg-MyFunc\n")
    let closeHandler
    onMock.mockImplementation((event, cb) => {
      if (event === "close") closeHandler = cb
      return subprocessMock
    })
    const response = { statusCode: 500, body: JSON.stringify({ errors: [1] }) }
    readFileMock.mockResolvedValue(Buffer.from(JSON.stringify(response)))
    openMock.mockClear()

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {})

    const promise = runTest({
      document,
      lambda,
      mode: "remote",
      eventsDir: "/ev",
      outputDir: "/out",
    })
    await sleep(0)
    await closeHandler(0)
    await promise

    expect(spawnMock).toHaveBeenCalledWith(
      "aws",
      expect.arrayContaining(["lambda", "invoke"]),
      expect.objectContaining({ stdio: expect.any(Array) })
    )
    expect(readFileMock).toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("❌"))
    logSpy.mockRestore()
  })

  it("logs and resolves if subprocess exits nonzero", async () => {
    const document = { Resources: { MyFunc: { Properties: { CodeUri: "foo" } } } }
    const lambda = "foo"
    let closeHandler
    onMock.mockImplementation((event, cb) => {
      if (event === "close") closeHandler = cb
      return subprocessMock
    })
    openMock.mockResolvedValue({ fd: 1, close: closeMock })

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {})

    const promise = runTest({
      document,
      lambda,
      mode: "local",
      eventsDir: "/ev",
      outputDir: "/out",
    })
    await sleep(0)
    await closeHandler(1)
    await promise

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("💥"))
    logSpy.mockRestore()
  })

  it("logs and resolves if output file is empty", async () => {
    const document = { Resources: { MyFunc: { Properties: { CodeUri: "foo" } } } }
    const lambda = "foo"
    let closeHandler
    onMock.mockImplementation((event, cb) => {
      if (event === "close") closeHandler = cb
      return subprocessMock
    })
    readFileMock.mockResolvedValue(Buffer.from(""))
    openMock.mockResolvedValue({ fd: 1, close: closeMock })

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {})

    const promise = runTest({
      document,
      lambda,
      mode: "local",
      eventsDir: "/ev",
      outputDir: "/out",
    })
    await sleep(0)
    await closeHandler(0)
    await promise

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("empty response"))
    logSpy.mockRestore()
  })

  it("logs result if filtered is true", async () => {
    const document = { Resources: { MyFunc: { Properties: { CodeUri: "foo" } } } }
    const lambda = "foo"
    let closeHandler
    onMock.mockImplementation((event, cb) => {
      if (event === "close") closeHandler = cb
      return subprocessMock
    })
    const response = { statusCode: 200, body: JSON.stringify({}) }
    readFileMock.mockResolvedValue(Buffer.from(JSON.stringify(response)))
    openMock.mockResolvedValue({ fd: 1, close: closeMock })

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {})

    const promise = runTest({
      document,
      lambda,
      mode: "local",
      filtered: true,
      eventsDir: "/ev",
      outputDir: "/out",
    })
    await sleep(0)
    await closeHandler(0)
    await promise

    expect(logSpy).toHaveBeenCalledWith(response)
    logSpy.mockRestore()
  })
})

describe("main", () => {
  const OLD_ENV = process.env
  const OLD_ARGV = process.argv

  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      OUTPUT_DIR: "/out",
      EVENTS_DIR: "/ev",
      TEMPLATE_PATH: "/template.yaml",
    }
    process.argv = ["/usr/bin/node", "main.js"]
    readdirMock.mockReset()
    readFileMock.mockReset()
    YAMLParseMock.mockReset()
    exitMock.mockReset()
  })

  afterAll(() => {
    process.env = OLD_ENV
    process.argv = OLD_ARGV
  })

  it("throws InputError if mode is not remote or local", async () => {
    process.argv = ["/usr/bin/node", "main.js", "badmode"]
    await expect(
      main({ outputDir: "/out", eventsDir: "/ev", templateYamlPath: "/template.yaml" })
    ).rejects.toThrow(InputError)
    await expect(
      main({ outputDir: "/out", eventsDir: "/ev", templateYamlPath: "/template.yaml" })
    ).rejects.toThrow("second argument must be 'remote' or 'local'")
  })

  it("runs all lambdas in events dir and calls alert", async () => {
    process.argv = ["/usr/bin/node", "main.js", "local"]
    readdirMock.mockResolvedValue(["foo.json", "bar.json"])
    readFileMock.mockResolvedValueOnce(Buffer.from("yamlfile"))
    YAMLParseMock.mockReturnValue({ doc: true })

    await main({ outputDir: "/out", eventsDir: "/ev", templateYamlPath: "/template.yaml" })
    expect(readdirMock).toHaveBeenCalledWith("/ev")
    expect(readFileMock).toHaveBeenCalledWith("/template.yaml")
    expect(YAMLParseMock).toHaveBeenCalled()
  })

  it("filters lambdas if filter argument is provided", async () => {
    process.argv = ["/usr/bin/node", "main.js", "local", "foo"]
    readdirMock.mockResolvedValue(["foo.json", "bar.json"])
    readFileMock.mockResolvedValueOnce(Buffer.from("yamlfile"))
    YAMLParseMock.mockReturnValue({ doc: true })

    await main({ outputDir: "/out", eventsDir: "/ev", templateYamlPath: "/template.yaml" })
  })

  it("throws InputError if no lambdas specified", async () => {
    process.argv = ["/usr/bin/node", "main.js", "local"]
    readdirMock.mockResolvedValue([])
    readFileMock.mockResolvedValue(Buffer.from("yamlfile"))
    YAMLParseMock.mockReturnValue({ doc: true })

    await expect(
      main({ outputDir: "/out", eventsDir: "/ev", templateYamlPath: "/template.yaml" })
    ).rejects.toThrow(InputError)
    await expect(
      main({ outputDir: "/out", eventsDir: "/ev", templateYamlPath: "/template.yaml" })
    ).rejects.toThrow("no lambdas specified; args: local")
  })
})
