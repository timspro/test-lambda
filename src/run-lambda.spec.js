/* eslint-disable no-restricted-syntax */
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

const { findFunctionName, resolveFunctionName, runLambda } = await import("./run-lambda.js")

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
  beforeEach(() => {
    execSyncMock.mockReset()
  })

  it("returns function name from execSync output", () => {
    execSyncMock.mockReturnValue("mypkg-abc-func\n")
    expect(resolveFunctionName("abc-func", { stackName: "mypkg" })).toBe("mypkg-abc-func")
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining("aws lambda list-functions"),
      expect.objectContaining({ encoding: "utf-8" })
    )
  })

  it("throws if execSync output is empty", () => {
    execSyncMock.mockReturnValue("")
    expect(() => resolveFunctionName("abc", { stackName: "mypkg" })).toThrow(
      "No function found with prefix: mypkg-abc"
    )
  })

  it('throws if execSync output is "None"', () => {
    execSyncMock.mockReturnValue("None\n")
    expect(() => resolveFunctionName("def", { stackName: "mypkg" })).toThrow(
      "No function found with prefix: mypkg-def"
    )
  })

  it("throws with error message if execSync throws", () => {
    execSyncMock.mockImplementation(() => {
      throw new Error("fail")
    })
    expect(() => resolveFunctionName("x", { stackName: "mypkg" })).toThrow(
      "Failed to resolve function: fail"
    )
  })

  it("uses stackName as prefix if provided", () => {
    execSyncMock.mockReturnValue("stack-foo-bar\n")
    expect(resolveFunctionName("bar", { stackName: "stack-foo" })).toBe("stack-foo-bar")
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining("starts_with(FunctionName, 'stack-foo-bar')"),
      expect.any(Object)
    )
  })

  it("falls back to no stackName if not provided", () => {
    execSyncMock.mockReturnValue("baz\n")
    expect(resolveFunctionName("baz")).toBe("baz")
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining("starts_with(FunctionName, 'baz')"),
      expect.any(Object)
    )
  })

  it("does not use stackName if it's an empty string", () => {
    execSyncMock.mockReturnValue("abc\n")
    expect(resolveFunctionName("abc", { stackName: "" })).toBe("abc")
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining("starts_with(FunctionName, 'abc')"),
      expect.any(Object)
    )
  })
})

describe("runTest", () => {
  let closeMock, onMock, subprocessMock

  beforeEach(() => {
    closeMock = jest.fn().mockResolvedValue()
    openMock.mockResolvedValue({ fd: 9, close: closeMock })
    readFileMock.mockReset()
    spawnMock.mockReset()
    onMock = jest.fn()
    subprocessMock = { on: onMock }
    spawnMock.mockReturnValue(subprocessMock)
  })

  it("returns undefined if functionName not found", async () => {
    const document = {}
    const lambda = "foo"
    const spy = jest.spyOn(console, "log").mockImplementation(() => {})
    const result = await runLambda({
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

    const promise = runLambda({
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
    execSyncMock.mockReturnValue("MyFunc\n")
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

  it("passes stackName to resolveFunctionName in remote mode", async () => {
    const document = { Resources: { MyFunc: { Properties: { CodeUri: "foo" } } } }
    const lambda = "foo"
    execSyncMock.mockReturnValue("stack-MyFunc\n")
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
      document,
      lambda,
      mode: "remote",
      eventsDir: "/ev",
      outputDir: "/out",
      stackName: "stack",
    })
    await sleep(0)
    await closeHandler(0)
    await promise

    // The execSyncMock should have been called with a query containing the stackName prefix
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining("starts_with(FunctionName, 'stack-MyFunc')"),
      expect.any(Object)
    )
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

    const promise = runLambda({
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

    const promise = runLambda({
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

    const promise = runLambda({
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
