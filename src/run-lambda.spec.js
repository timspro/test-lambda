import { jest } from "@jest/globals"
import { sleep } from "@tim-code/my-util"

// Mocks for external modules and functions
const spawnMock = jest.fn()
const openMock = jest.fn()
const readFileMock = jest.fn()
const resolvePhysicalIdMock = jest.fn()

jest.unstable_mockModule("node:child_process", () => ({
  spawn: spawnMock,
}))
jest.unstable_mockModule("node:fs/promises", () => ({
  open: openMock,
  readFile: readFileMock,
}))
jest.unstable_mockModule("./util.js", () => ({
  resolvePhysicalId: resolvePhysicalIdMock,
}))

const { runLambda } = await import("./run-lambda.js")

describe("runLambda", () => {
  let closeMock, onMock, subprocessMock

  beforeEach(() => {
    closeMock = jest.fn().mockResolvedValue()
    openMock.mockReset()
    openMock.mockResolvedValue({ fd: 9, close: closeMock })
    readFileMock.mockReset()
    spawnMock.mockReset()
    resolvePhysicalIdMock.mockReset()
    onMock = jest.fn()
    subprocessMock = { on: onMock }
    spawnMock.mockReturnValue(subprocessMock)
  })

  it("runs local mode and handles success path", async () => {
    const inputPath = "/ev/foo.json"
    const outputPath = "/out/foo.json"
    const logicalId = "MyFunc"
    const eventName = "MyEvent"

    let closeHandler
    onMock.mockImplementation((event, cb) => {
      if (event === "close") closeHandler = cb
      return subprocessMock
    })

    const response = { statusCode: 200, body: JSON.stringify({}) }
    readFileMock.mockResolvedValue(Buffer.from(JSON.stringify(response)))
    openMock.mockResolvedValue({ fd: 1, close: closeMock })

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {})

    const promise = runLambda({
      inputPath,
      outputPath,
      logicalId,
      eventName,
      mode: "local",
    })
    await sleep(0)
    await closeHandler(0)
    await promise

    expect(spawnMock).toHaveBeenCalledWith(
      "sam",
      expect.arrayContaining(["local", "invoke", logicalId, "--event", inputPath]),
      expect.objectContaining({ stdio: expect.any(Array) })
    )
    expect(openMock).toHaveBeenCalledWith(outputPath, "w")
    expect(closeMock).toHaveBeenCalled()
    expect(readFileMock).toHaveBeenCalledWith(outputPath)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`✅ ${eventName}`))
    logSpy.mockRestore()
  })

  it("runs remote mode and handles non-200/error status", async () => {
    const inputPath = "/ev/foo.json"
    const outputPath = "/out/foo.json"
    const logicalId = "MyFunc"
    const eventName = "MyEvent"
    resolvePhysicalIdMock.mockReturnValue("ActualFunc")

    let closeHandler
    onMock.mockImplementation((event, cb) => {
      if (event === "close") closeHandler = cb
      return subprocessMock
    })

    const response = { statusCode: 500, body: JSON.stringify({ errors: [1] }) }
    readFileMock.mockResolvedValue(Buffer.from(JSON.stringify(response)))
    openMock.mockClear()

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {})

    const promise = runLambda({
      inputPath,
      outputPath,
      logicalId,
      eventName,
      mode: "remote",
    })
    await sleep(0)
    await closeHandler(0)
    await promise

    expect(resolvePhysicalIdMock).toHaveBeenCalledWith({ logicalId, stackName: undefined })
    expect(spawnMock).toHaveBeenCalledWith(
      "aws",
      expect.arrayContaining([
        "lambda",
        "invoke",
        "--function-name",
        "ActualFunc",
        "--payload",
        `file://${inputPath}`,
      ]),
      expect.objectContaining({ stdio: ["inherit", "ignore", "inherit"] })
    )
    expect(openMock).not.toHaveBeenCalled()
    expect(readFileMock).toHaveBeenCalledWith(outputPath)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`❌ ${eventName}`))
    logSpy.mockRestore()
  })

  it("passes stackName and logicalId to resolvePhysicalId in remote mode", async () => {
    const inputPath = "/ev/foo.json"
    const outputPath = "/out/foo.json"
    const logicalId = "MyFunc"
    const eventName = "MyEvent"
    resolvePhysicalIdMock.mockReturnValue("stack-MyFunc")

    let closeHandler
    onMock.mockImplementation((event, cb) => {
      if (event === "close") closeHandler = cb
      return subprocessMock
    })
    const response = { statusCode: 200, body: JSON.stringify({}) }
    readFileMock.mockResolvedValue(Buffer.from(JSON.stringify(response)))

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {})

    const promise = runLambda({
      inputPath,
      outputPath,
      logicalId,
      eventName,
      mode: "remote",
      stackName: "stack",
    })
    await sleep(0)
    await closeHandler(0)
    await promise

    expect(resolvePhysicalIdMock).toHaveBeenCalledWith({ logicalId: "MyFunc", stackName: "stack" })
    expect(spawnMock).toHaveBeenCalledWith(
      "aws",
      expect.arrayContaining(["--function-name", "stack-MyFunc"]),
      expect.any(Object)
    )
    logSpy.mockRestore()
  })

  it("logs and resolves if subprocess exits nonzero", async () => {
    const inputPath = "/ev/foo.json"
    const outputPath = "/out/foo.json"
    const logicalId = "MyFunc"
    const eventName = "MyEvent"

    let closeHandler
    onMock.mockImplementation((event, cb) => {
      if (event === "close") closeHandler = cb
      return subprocessMock
    })
    openMock.mockResolvedValue({ fd: 1, close: closeMock })

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {})

    const promise = runLambda({
      inputPath,
      outputPath,
      logicalId,
      eventName,
      mode: "local",
    })
    await sleep(0)
    await closeHandler(1)
    await promise

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(`💥 ${eventName} exited with code 1`)
    )
    logSpy.mockRestore()
  })

  it("logs and resolves if output file is empty", async () => {
    const inputPath = "/ev/foo.json"
    const outputPath = "/out/foo.json"
    const logicalId = "MyFunc"
    const eventName = "MyEvent"

    let closeHandler
    onMock.mockImplementation((event, cb) => {
      if (event === "close") closeHandler = cb
      return subprocessMock
    })
    readFileMock.mockResolvedValue(Buffer.from(""))
    openMock.mockResolvedValue({ fd: 1, close: closeMock })

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {})

    const promise = runLambda({
      inputPath,
      outputPath,
      logicalId,
      eventName,
      mode: "local",
    })
    await sleep(0)
    await closeHandler(0)
    await promise

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(`❌ ${eventName} - empty response`)
    )
    logSpy.mockRestore()
  })

  it("logs result if filtered is true", async () => {
    const inputPath = "/ev/foo.json"
    const outputPath = "/out/foo.json"
    const logicalId = "MyFunc"
    const eventName = "MyEvent"

    let closeHandler
    onMock.mockImplementation((event, cb) => {
      if (event === "close") closeHandler = cb
      return subprocessMock
    })
    const response = { statusCode: 200, body: JSON.stringify({}) }
    readFileMock.mockResolvedValue(Buffer.from(JSON.stringify(response)))
    openMock.mockResolvedValue({ fd: 1, close: closeMock })

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {})

    const promise = runLambda({
      inputPath,
      outputPath,
      logicalId,
      eventName,
      mode: "local",
      filtered: true,
    })
    await sleep(0)
    await closeHandler(0)
    await promise

    expect(logSpy).toHaveBeenCalledWith(response)
    logSpy.mockRestore()
  })

  it("treats statusCode 200 with body.errors as failure", async () => {
    const inputPath = "/ev/foo.json"
    const outputPath = "/out/foo.json"
    const logicalId = "MyFunc"
    const eventName = "MyEvent"

    let closeHandler
    onMock.mockImplementation((event, cb) => {
      if (event === "close") closeHandler = cb
      return subprocessMock
    })
    const response = { statusCode: 200, body: { errors: ["x"] } }
    readFileMock.mockResolvedValue(Buffer.from(JSON.stringify(response)))
    openMock.mockResolvedValue({ fd: 1, close: closeMock })

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {})

    const promise = runLambda({
      inputPath,
      outputPath,
      logicalId,
      eventName,
      mode: "local",
    })
    await sleep(0)
    await closeHandler(0)
    await promise

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`❌ ${eventName}`))
    logSpy.mockRestore()
  })

  it("treats statusCode 200 with top-level errors as failure", async () => {
    const inputPath = "/ev/foo.json"
    const outputPath = "/out/foo.json"
    const logicalId = "MyFunc"
    const eventName = "MyEvent"

    let closeHandler
    onMock.mockImplementation((event, cb) => {
      if (event === "close") closeHandler = cb
      return subprocessMock
    })
    const response = { statusCode: 200, errors: ["boom"] }
    readFileMock.mockResolvedValue(Buffer.from(JSON.stringify(response)))
    openMock.mockResolvedValue({ fd: 1, close: closeMock })

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {})

    const promise = runLambda({
      inputPath,
      outputPath,
      logicalId,
      eventName,
      mode: "local",
    })
    await sleep(0)
    await closeHandler(0)
    await promise

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`❌ ${eventName}`))
    logSpy.mockRestore()
  })

  it("propagates error if resolvePhysicalId throws in remote mode", async () => {
    const inputPath = "/ev/foo.json"
    const outputPath = "/out/foo.json"
    const logicalId = "MyFunc"
    const eventName = "MyEvent"
    resolvePhysicalIdMock.mockImplementation(() => {
      throw new Error("no physical ID")
    })

    await expect(
      runLambda({
        inputPath,
        outputPath,
        logicalId,
        eventName,
        mode: "remote",
        stackName: "stack",
      })
    ).rejects.toThrow("no physical ID")

    expect(spawnMock).not.toHaveBeenCalled()
  })
})

// ISSUE: runLambda assumes resolvePhysicalId is synchronous. If util.js ever makes it async, runLambda will break because it does not await it.
// ISSUE: The success/failure check does not parse result.body when it is a JSON string (common for Lambda proxy integrations). Errors inside a JSON string body will be ignored.