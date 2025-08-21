import { jest } from "@jest/globals"

// Mocks for external modules and functions
const readFileMock = jest.fn()
const readdirMock = jest.fn()
const mkdirMock = jest.fn()
const YAMLParseMock = jest.fn()
const runLambdaMock = jest.fn()

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

const { main, InputError } = await import("./main.js")

describe("main", () => {
  beforeEach(() => {
    readdirMock.mockReset()
    readFileMock.mockReset()
    YAMLParseMock.mockReset()
    mkdirMock.mockReset()
    runLambdaMock.mockReset()
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
    YAMLParseMock.mockReturnValue({ doc: true })
    runLambdaMock.mockResolvedValue(undefined)

    await main({
      argv,
      outputDir: "/out",
      eventsDir: "/ev",
      templateYamlPath: "/template.yaml",
    })
    expect(mkdirMock).toHaveBeenCalledWith("/out", { recursive: true })
  })

  it("runs all lambdas in events dir and calls runLambda for each", async () => {
    const argv = ["/usr/bin/node", "main.js", "local"]
    readdirMock.mockResolvedValue(["foo.json", "bar.json"])
    readFileMock.mockResolvedValue(Buffer.from("yamlfile"))
    YAMLParseMock.mockReturnValue({ doc: true })
    runLambdaMock.mockResolvedValue(undefined)

    await main({
      argv,
      outputDir: "/out",
      eventsDir: "/ev",
      templateYamlPath: "/template.yaml",
    })
    expect(readdirMock).toHaveBeenCalledWith("/ev")
    expect(readFileMock).toHaveBeenCalledWith("/template.yaml")
    expect(YAMLParseMock).toHaveBeenCalled()
    expect(runLambdaMock).toHaveBeenCalledTimes(2)
    expect(runLambdaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        outputDir: "/out",
        eventsDir: "/ev",
        document: expect.any(Object),
        lambda: "foo",
        mode: "local",
        filtered: false,
      })
    )
    expect(runLambdaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lambda: "bar",
      })
    )
  })

  it("filters lambdas if filter argument is provided", async () => {
    const argv = ["/usr/bin/node", "main.js", "local", "foo"]
    readdirMock.mockResolvedValue(["foo.json", "bar.json"])
    readFileMock.mockResolvedValue(Buffer.from("yamlfile"))
    YAMLParseMock.mockReturnValue({ doc: true })
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
        lambda: "foo",
        filtered: true,
      })
    )
  })

  it("throws InputError if no lambdas specified", async () => {
    const argv = ["/usr/bin/node", "main.js", "local"]
    readdirMock.mockResolvedValue([])
    readFileMock.mockResolvedValue(Buffer.from("yamlfile"))
    YAMLParseMock.mockReturnValue({ doc: true })
    runLambdaMock.mockResolvedValue(undefined)

    await expect(
      main({ argv, outputDir: "/out", eventsDir: "/ev", templateYamlPath: "/template.yaml" })
    ).rejects.toThrow(InputError)
    await expect(
      main({ argv, outputDir: "/out", eventsDir: "/ev", templateYamlPath: "/template.yaml" })
    ).rejects.toThrow("no lambdas specified; args: local")
    expect(runLambdaMock).not.toHaveBeenCalled()
  })

  it("passes stackName to runLambda", async () => {
    const argv = ["/usr/bin/node", "main.js", "remote"]
    readdirMock.mockResolvedValue(["foo.json"])
    readFileMock.mockResolvedValue(Buffer.from("yamlfile"))
    YAMLParseMock.mockReturnValue({
      Resources: { MyFunc: { Properties: { CodeUri: "foo" } } },
    })
    runLambdaMock.mockResolvedValue(undefined)

    await main({
      argv,
      outputDir: "/out",
      eventsDir: "/ev",
      templateYamlPath: "/template.yaml",
      stackName: "stack",
    })

    expect(runLambdaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stackName: "stack",
      })
    )
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

// No tests for findFunctionName, resolveFunctionName, or runTest since these are no longer exported.
