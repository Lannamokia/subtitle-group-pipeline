describe("env config", () => {
  it("rejects CORS_ORIGIN='*'", async () => {
    const original = process.env.CORS_ORIGIN;
    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((code?: number | string | null) => {
        throw new Error(`process.exit(${code})`);
      });

    try {
      process.env.CORS_ORIGIN = "*";
      jest.resetModules();
      await expect(import("../config/env")).rejects.toThrow("process.exit(1)");
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
      process.env.CORS_ORIGIN = original;
      jest.resetModules();
    }
  });
});
