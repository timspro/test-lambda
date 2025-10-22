import { jest } from "@jest/globals"
import { sleep } from "@tim-code/my-util"

// Mocks for external modules and functions
const execSyncMock = jest.fn()
const spawnMock = jest.fn()
const openMock = jest.fn()
const readFileMock = jest.fn()

jest.unstable_mockModule("node:child_process", () => ({
  execSync: execSyncMock,
  spawn: spawnMock,
}))
jest.unstable_mockModule("node:fs/promises", () => ({
  open: openMock,
  readFile: readFileMock,
}))

const { resolvePhysicalId, runLambda } = await import("./run-lambda.js")

describe("resolvePhysicalId", () => {
  beforeEach(() => {
    execSyncMock.mockReset()
  })

  it("returns physical ID from execSync output and uses CloudFormation query with stack name and logical ID", () => {
    execSyncMock.mockReturnValue("stack-MyFunc\n")
    expect(resolvePhysicalId({ logicalId: "MyFunc", stackName: "stack" })).toBe("stack-MyFunc")
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining("cloudformation list-stack-resources"),
      expect.objectContaining({ encoding: "utf-8" })
    )
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('--stack-name "stack"'),
      expect.any(Object)
    )
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining("LogicalResourceId=='MyFunc'"),
      expect.any(Object)
    )
  })

  it("throws if execSync output is empty", () => {
    execSyncMock.mockReturnValue("")
    expect(() => resolvePhysicalId({ logicalId: "MyFunc", stackName: "stack" })).toThrow(
      "failed to resolve function: no physical ID found for logical ID: MyFunc"
    )
  })

  it('throws if execSync output is "None"', () => {
    execSyncMock.mockReturnValue("None\n")
    expect(() => resolvePhysicalId({ logicalId: "MyFunc", stackName: "stack" })).toThrow(
      "failed to resolve function: no physical ID found for logical ID: MyFunc"
    )
  })

  it("throws with error message if execSync throws", () => {
    execSyncMock.mockImplementation(() => {
      throw new Error("fail")
    })
    expect(() => resolvePhysicalId({ logicalId: "MyFunc", stackName: "stack" })).toThrow(
      "failed to resolve function: fail"
    )
  })
})

describe("runLambda", () => {
  let closeMock, onMock, subprocessMock

  beforeEach(() => {
    closeMock = jest.fn().mockResolvedValue()
    openMock.mockReset()
    openMock.mockResolvedValue({ fd: 9, close: closeMock })
    readFileMock.mockReset()
    spawnMock.mockReset()
    execSyncMock.mockReset()
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
    execSyncMock.mockReturnValue("ActualFunc\n")

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
    execSyncMock.mockReturnValue("stack-MyFunc\n")

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

    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining("cloudformation list-stack-resources"),
      expect.any(Object)
    )
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('--stack-name "stack"'),
      expect.any(Object)
    )
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining("LogicalResourceId=='MyFunc'"),
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

  it("throws if resolvePhysicalId fails in remote mode", async () => {
    const inputPath = "/ev/foo.json"
    const outputPath = "/out/foo.json"
    const logicalId = "MyFunc"
    const eventName = "MyEvent"
    execSyncMock.mockReturnValue("None\n")

    await expect(
      runLambda({
        inputPath,
        outputPath,
        logicalId,
        eventName,
        mode: "remote",
        stackName: "stack",
      })
    ).rejects.toThrow(
      "failed to resolve function: no physical ID found for logical ID: MyFunc"
    )
  })
})
