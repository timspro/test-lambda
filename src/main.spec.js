import { jest } from "@jest/globals"

const readFileMock = jest.fn()
const readdirMock = jest.fn()
const mkdirMock = jest.fn()
const YAMLParseMock = jest.fn()
const runLambdaMock = jest.fn()
const runStateMachineMock = jest.fn()

jest.unstable_mockModule("node:fs/promises", () => ({
  mkdir: mkdirMock,
  readFile: readFileMock,
  readdir: readdirMock,
}))
jest.unstable_mockModule("yaml", () => ({
  default: { parse: YAMLParseMock },
}))
jest.unstable_mockModule("./run-lambda.js", () => ({
  runLambda: runLambdaMock,
}))
jest.unstable_mockModule("./run-state-machine.js", () => ({
  runStateMachine: runStateMachineMock,
}))

const { main, InputError, getDefinition, findFunctionLogicalId } = await import("./main.js")

describe("main", () => {
  beforeEach(() => {
    readdirMock.mockReset()
    readFileMock.mockReset()
    YAMLParseMock.mockReset()
    mkdirMock.mockReset()
    runLambdaMock.mockReset()
    runStateMachineMock.mockReset()
    jest.restoreAllMocks()
  })

  it("throws InputError if mode is not remote or local", async () => {
    const argv = ["/usr/bin/node", "main.js", "badmode"]
    await expect(
      main({ argv, outputDir: "/out", eventsDir: "/ev", templateYamlPath: "/template.yaml" })
    ).rejects.toThrow(InputError)
    await expect(
      main({ argv, outputDir: "/out", eventsDir: "/ev", templateYamlPath: "/template.yaml" })
    ).rejects.toThrow("second argument must be 'remote' or 'local'")
  })

  it("calls mkdir with recursive:true before proceeding", async () => {
    const argv = ["/usr/bin/node", "main.js", "local"]
    readdirMock.mockResolvedValue(["foo.json"])
    readFileMock.mockResolvedValue(Buffer.from("yamlfile"))
    YAMLParseMock.mockReturnValue({
      Resources: { foo: { Type: "AWS::Serverless::Function", Properties: {} } },
    })
    runLambdaMock.mockResolvedValue(undefined)

    await main({
      argv,
      outputDir: "/out",
      eventsDir: "/ev",
      templateYamlPath: "/template.yaml",
    })
    expect(mkdirMock).toHaveBeenCalledWith("/out", { recursive: true })
  })

  it("runs all events and dispatches to lambda and state machine in remote mode", async () => {
    const argv = ["/usr/bin/node", "main.js", "remote"]
    readdirMock.mockResolvedValue(["func.json", "sm.json"])
    readFileMock.mockResolvedValue(Buffer.from("yamlfile"))
    YAMLParseMock.mockReturnValue({
      Resources: {
        func: { Type: "AWS::Serverless::Function", Properties: { CodeUri: "dist/func" } },
        sm: { Type: "AWS::Serverless::StateMachine", Properties: {} },
      },
    })
    runLambdaMock.mockResolvedValue(undefined)
    runStateMachineMock.mockResolvedValue(undefined)

    await main({
      argv,
      outputDir: "/out",
      eventsDir: "/ev",
      templateYamlPath: "/template.yaml",
      stackName: "stack",
    })

    expect(readdirMock).toHaveBeenCalledWith("/ev")
    expect(readFileMock).toHaveBeenCalledWith("/template.yaml")
    expect(runLambdaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inputPath: "/ev/func.json",
        outputPath: "/out/func.json",
        logicalId: "func",
        eventName: "func",
        mode: "remote",
        stackName: "stack",
        filtered: false,
      })
    )
    expect(runStateMachineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inputPath: "/ev/sm.json",
        outputPath: "/out/sm.json",
        logicalId: "sm",
        eventName: "sm",
        stackName: "stack",
      })
    )
  })

  it("filters events if filter argument is provided", async () => {
    const argv = ["/usr/bin/node", "main.js", "local", "foo"]
    readdirMock.mockResolvedValue(["foo.json", "bar.json"])
    readFileMock.mockResolvedValue(Buffer.from("yamlfile"))
    YAMLParseMock.mockReturnValue({
      Resources: {
        foo: { Type: "AWS::Serverless::Function", Properties: {} },
        bar: { Type: "AWS::Serverless::Function", Properties: {} },
      },
    })
    runLambdaMock.mockResolvedValue(undefined)

    await main({
      argv,
      outputDir: "/out",
      eventsDir: "/ev",
      templateYamlPath: "/template.yaml",
    })
    expect(runLambdaMock).toHaveBeenCalledTimes(1)
    expect(runLambdaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        logicalId: "foo",
        eventName: "foo",
        filtered: true,
      })
    )
  })

  it("uses CodeUri suffix to resolve logical ID when event name doesn't equal logical ID", async () => {
    const argv = ["/usr/bin/node", "main.js", "local"]
    readdirMock.mockResolvedValue(["query.json"])
    readFileMock.mockResolvedValue(Buffer.from("yamlfile"))
    YAMLParseMock.mockReturnValue({
      Resources: {
        UsersQuery: {
          Type: "AWS::Serverless::Function",
          Properties: { CodeUri: "dist/users-query" },
        },
      },
    })
    runLambdaMock.mockResolvedValue(undefined)

    await main({
      argv,
      outputDir: "/out",
      eventsDir: "/ev",
      templateYamlPath: "/template.yaml",
    })

    expect(runLambdaMock).toHaveBeenCalledTimes(1)
    expect(runLambdaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        inputPath: "/ev/query.json",
        outputPath: "/out/query.json",
        logicalId: "UsersQuery",
        eventName: "query",
      })
    )
  })

  it("throws InputError if no events specified (empty dir or filter removes all)", async () => {
    const argv = ["/usr/bin/node", "main.js", "local"]
    readdirMock.mockResolvedValue([])
    readFileMock.mockResolvedValue(Buffer.from("yamlfile"))
    YAMLParseMock.mockReturnValue({ Resources: {} })
    runLambdaMock.mockResolvedValue(undefined)

    await expect(
      main({ argv, outputDir: "/out", eventsDir: "/ev", templateYamlPath: "/template.yaml" })
    ).rejects.toThrow(InputError)
    await expect(
      main({ argv, outputDir: "/out", eventsDir: "/ev", templateYamlPath: "/template.yaml" })
    ).rejects.toThrow("no events specified")
    expect(runLambdaMock).not.toHaveBeenCalled()
  })

  it("logs and skips events with unknown resource types and then throws when nothing runnable", async () => {
    const argv = ["/usr/bin/node", "main.js", "local"]
    readdirMock.mockResolvedValue(["weird.json"])
    readFileMock.mockResolvedValue(Buffer.from("yamlfile"))
    YAMLParseMock.mockReturnValue({
      Resources: { weird: { Type: "SomethingElse", Properties: {} } },
    })
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      main({ argv, outputDir: "/out", eventsDir: "/ev", templateYamlPath: "/template.yaml" })
    ).rejects.toThrow("no lambdas or state machines specified")

    expect(errSpy).toHaveBeenCalledWith("unknown type SomethingElse for weird")
    expect(runLambdaMock).not.toHaveBeenCalled()
    expect(runStateMachineMock).not.toHaveBeenCalled()
  })

  it("logs a notice for state machines in local mode when filtered and then throws", async () => {
    const argv = ["/usr/bin/node", "main.js", "local", "sm"]
    readdirMock.mockResolvedValue(["sm.json"])
    readFileMock.mockResolvedValue(Buffer.from("yamlfile"))
    YAMLParseMock.mockReturnValue({
      Resources: { sm: { Type: "AWS::Serverless::StateMachine", Properties: {} } },
    })
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {})

    await expect(
      main({ argv, outputDir: "/out", eventsDir: "/ev", templateYamlPath: "/template.yaml" })
    ).rejects.toThrow("no lambdas or state machines specified")

    expect(logSpy).toHaveBeenCalledWith('state machines must be run with mode "remote"')
    expect(runStateMachineMock).not.toHaveBeenCalled()
  })

  it("throws and logs when it cannot find logical id for an event", async () => {
    const argv = ["/usr/bin/node", "main.js", "local"]
    readdirMock.mockResolvedValue(["missing.json"])
    readFileMock.mockResolvedValue(Buffer.from("yamlfile"))
    YAMLParseMock.mockReturnValue({
      Resources: {
        OtherFunc: {
          Type: "AWS::Serverless::Function",
          Properties: { CodeUri: "dist/other" },
        },
      },
    })
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      main({ argv, outputDir: "/out", eventsDir: "/ev", templateYamlPath: "/template.yaml" })
    ).rejects.toThrow("no lambdas or state machines specified")

    expect(errSpy).toHaveBeenCalledWith("could not find logical id for missing")
    expect(runLambdaMock).not.toHaveBeenCalled()
    expect(runStateMachineMock).not.toHaveBeenCalled()
  })

  it("passes stackName through to runLambda and runStateMachine", async () => {
    const argv = ["/usr/bin/node", "main.js", "remote"]
    readdirMock.mockResolvedValue(["foo.json", "sm.json"])
    readFileMock.mockResolvedValue(Buffer.from("yamlfile"))
    YAMLParseMock.mockReturnValue({
      Resources: {
        foo: { Type: "AWS::Serverless::Function", Properties: { CodeUri: "foo" } },
        sm: { Type: "AWS::Serverless::StateMachine", Properties: {} },
      },
    })
    runLambdaMock.mockResolvedValue(undefined)
    runStateMachineMock.mockResolvedValue(undefined)

    await main({
      argv,
      outputDir: "/out",
      eventsDir: "/ev",
      templateYamlPath: "/template.yaml",
      stackName: "stack",
    })

    expect(runLambdaMock).toHaveBeenCalledWith(expect.objectContaining({ stackName: "stack" }))
    expect(runStateMachineMock).toHaveBeenCalledWith(
      expect.objectContaining({ stackName: "stack" })
    )
  })

  it("logs errors from failed invocations via allSettled and does not throw", async () => {
    const argv = ["/usr/bin/node", "main.js", "remote"]
    readdirMock.mockResolvedValue(["func.json", "sm.json"])
    readFileMock.mockResolvedValue(Buffer.from("yamlfile"))
    YAMLParseMock.mockReturnValue({
      Resources: {
        func: { Type: "AWS::Serverless::Function", Properties: {} },
        sm: { Type: "AWS::Serverless::StateMachine", Properties: {} },
      },
    })
    const err1 = new Error("lambda failed")
    const err2 = new Error("state machine failed")
    runLambdaMock.mockRejectedValue(err1)
    runStateMachineMock.mockRejectedValue(err2)
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {})

    // Should resolve without throwing even when underlying invocations fail
    await expect(
      main({
        argv,
        outputDir: "/out",
        eventsDir: "/ev",
        templateYamlPath: "/template.yaml",
        stackName: "stack",
      })
    ).resolves.toBeUndefined()

    expect(errSpy).toHaveBeenCalledWith(err1.message, err2.message)
  })
})

describe("getDefinition", () => {
  it("returns the resource definition for a logical ID", () => {
    const doc = { Resources: { MyFunc: { Type: "AWS::Serverless::Function" } } }
    expect(getDefinition(doc, "MyFunc")).toEqual({ Type: "AWS::Serverless::Function" })
  })

  it("returns undefined when logical ID is missing", () => {
    const doc = { Resources: { Other: { Type: "AWS::Serverless::Function" } } }
    expect(getDefinition(doc, "Missing")).toBeUndefined()
  })
})

describe("findFunctionLogicalId", () => {
  it("finds the logical ID by matching CodeUri suffix", () => {
    const doc = {
      Resources: {
        UsersQuery: {
          Type: "AWS::Serverless::Function",
          Properties: { CodeUri: "dist/users-query" },
        },
        Other: {
          Type: "AWS::Serverless::Function",
          Properties: { CodeUri: "dist/other" },
        },
      },
    }
    expect(findFunctionLogicalId(doc, "users-query")).toBe("UsersQuery")
    expect(findFunctionLogicalId(doc, "dist/users-query")).toBe("UsersQuery")
  })

  it("returns undefined when no CodeUri suffix matches", () => {
    const doc = {
      Resources: {
        A: { Type: "AWS::Serverless::Function", Properties: { CodeUri: "a/b/c" } },
        B: { Type: "AWS::Serverless::Function", Properties: { CodeUri: "x/y/z" } },
      },
    }
    expect(findFunctionLogicalId(doc, "nope")).toBeUndefined()
  })
})

describe("InputError", () => {
  it("is an Error subclass", () => {
    const err = new InputError("bad input")
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(InputError)
    expect(err.message).toBe("bad input")
  })
})
