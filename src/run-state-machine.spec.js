import { jest } from "@jest/globals"

// Mocks
const sleepMock = jest.fn(() => Promise.resolve())
jest.unstable_mockModule("@tim-code/my-util", () => ({
  sleep: sleepMock,
}))
const writeFileMock = jest.fn(() => Promise.resolve())
jest.unstable_mockModule("node:fs/promises", () => ({
  writeFile: writeFileMock,
}))
const execSyncMock = jest.fn()
jest.unstable_mockModule("node:child_process", () => ({
  execSync: execSyncMock,
}))
const resolvePhysicalIdMock = jest.fn()
jest.unstable_mockModule("./util.js", () => ({
  resolvePhysicalId: resolvePhysicalIdMock,
}))

const { runStateMachine } = await import("./run-state-machine.js")

describe("runStateMachine", () => {
  let consoleSpy
  beforeEach(() => {
    jest.clearAllMocks()
    consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {})
    resolvePhysicalIdMock.mockReturnValue(
      "arn:aws:states:us-east-1:123456789012:stateMachine:example"
    )
  })
  afterEach(() => {
    consoleSpy.mockRestore()
  })

  test("polls until not RUNNING, writes output, logs when filtered", async () => {
    execSyncMock
      // start-execution -> returns executionArn
      .mockReturnValueOnce(
        "arn:aws:states:us-east-1:123456789012:execution:example:exec-123\n"
      )
      // describe-execution status -> RUNNING
      .mockReturnValueOnce("RUNNING\n")
      // describe-execution status -> SUCCEEDED
      .mockReturnValueOnce("SUCCEEDED\n")
      // describe-execution output -> JSON output
      .mockReturnValueOnce('{"ok":true,"value":42}\n')

    const result = await runStateMachine({
      inputPath: "/tmp/input.json",
      outputPath: "/tmp/output.json",
      logicalId: "MyStateMachine",
      eventName: "myEvent",
      stackName: "myStack",
      filtered: true,
    })

    // sanity checks on CLI calls
    expect(execSyncMock).toHaveBeenCalled()
    expect(
      execSyncMock.mock.calls.some(
        ([cmd]) =>
          cmd.includes("aws stepfunctions start-execution") &&
          cmd.includes(
            "--state-machine-arn arn:aws:states:us-east-1:123456789012:stateMachine:example"
          ) &&
          cmd.includes("--input file:///tmp/input.json")
      )
    ).toBe(true)
    expect(
      execSyncMock.mock.calls.some(
        ([cmd]) =>
          cmd.includes("aws stepfunctions describe-execution") &&
          cmd.includes("--query status")
      )
    ).toBe(true)
    expect(
      execSyncMock.mock.calls.some(
        ([cmd]) =>
          cmd.includes("aws stepfunctions describe-execution") &&
          cmd.includes("--query output")
      )
    ).toBe(true)

    expect(sleepMock).toHaveBeenCalledTimes(1)
    expect(sleepMock).toHaveBeenCalledWith(5000)

    expect(writeFileMock).toHaveBeenCalledWith("/tmp/output.json", '{"ok":true,"value":42}')
    expect(result).toEqual({
      status: "SUCCEEDED",
      output: '{"ok":true,"value":42}',
      executionArn: "arn:aws:states:us-east-1:123456789012:execution:example:exec-123",
    })

    // filtered=true should log the output string
    expect(consoleSpy.mock.calls.some((call) => call[0] === '{"ok":true,"value":42}')).toBe(
      true
    )
  })

  test('immediate non-RUNNING status writes empty output when CLI returns "None" and does not log when filtered=false', async () => {
    execSyncMock
      // start-execution -> returns executionArn
      .mockReturnValueOnce("arn:aws:states:region:acct:execution:example:exec-xyz\n")
      // describe-execution status -> FAILED (not RUNNING)
      .mockReturnValueOnce("FAILED\n")
      // describe-execution output -> "None"
      .mockReturnValueOnce("None\n")

    const result = await runStateMachine({
      inputPath: "/tmp/input.json",
      outputPath: "/tmp/output2.json",
      logicalId: "MyStateMachine",
      eventName: "evt",
      stackName: "stack",
      filtered: false,
    })

    expect(sleepMock).not.toHaveBeenCalled()
    expect(writeFileMock).toHaveBeenCalledWith("/tmp/output2.json", "")
    expect(result).toEqual({
      status: "FAILED",
      output: "",
      executionArn: "arn:aws:states:region:acct:execution:example:exec-xyz",
    })

    // No extra log with the output since filtered=false (other logs from startExecutionCLI may exist)
    expect(consoleSpy.mock.calls.some((call) => call[0] === "")).toBe(false)
  })

  test("propagates error when start-execution returns empty ARN", async () => {
    execSyncMock
      // start-execution -> empty trimmed => throws in startExecutionCLI
      .mockReturnValueOnce(" \n")

    await expect(
      runStateMachine({
        inputPath: "/tmp/input.json",
        outputPath: "/tmp/output.json",
        logicalId: "MyStateMachine",
        eventName: "evt",
        stackName: "stack",
        filtered: false,
      })
    ).rejects.toThrow("could not start execution")

    // After failure to start, there should be no polling/output fetch or file writes
    expect(execSyncMock).toHaveBeenCalledTimes(1)
    expect(writeFileMock).not.toHaveBeenCalled()
    expect(sleepMock).not.toHaveBeenCalled()
  })
})
