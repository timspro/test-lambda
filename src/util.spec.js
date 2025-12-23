import { jest } from "@jest/globals"

// Mocks for external modules and functions
const execSyncMock = jest.fn()

jest.unstable_mockModule("node:child_process", () => ({
  execSync: execSyncMock,
}))

const { resolvePhysicalId } = await import("./util.js")

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
      /no physical ID found for logical ID MyFunc/
    )
  })

  it('throws if execSync output is "None"', () => {
    execSyncMock.mockReturnValue("None\n")
    expect(() => resolvePhysicalId({ logicalId: "MyFunc", stackName: "stack" })).toThrow(
      /no physical ID found for logical ID MyFunc/
    )
  })

  it("throws with error message if execSync throws", () => {
    execSyncMock.mockImplementation(() => {
      throw new Error("fail")
    })
    expect(() => resolvePhysicalId({ logicalId: "MyFunc", stackName: "stack" })).toThrow(
      "fail"
    )
  })
})
