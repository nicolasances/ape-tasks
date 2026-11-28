import assert from "assert";
import { findTaskType, supportedTaskTypes } from "../../src/util/TaskTypes";

describe("TaskTypes registry", () => {

    it("lists coding as the only supported task type", () => {

        assert.deepStrictEqual(supportedTaskTypes(), ["coding"]);
    });

    it("routes coding tasks to the coder/ prefix and the agentCoderTasks topic", () => {

        const codingTaskType = findTaskType("coding");

        assert.strictEqual(codingTaskType?.bucketPrefix, "coder");
        assert.strictEqual(codingTaskType?.topic, "agentCoderTasks");
    });

    it("returns undefined for an unknown task type", () => {

        assert.strictEqual(findTaskType("review"), undefined);
    });

    it("returns undefined for names inherited from Object.prototype", () => {

        assert.strictEqual(findTaskType("toString"), undefined);
        assert.strictEqual(findTaskType("__proto__"), undefined);
    });
});

describe("coding task type - validatePayload", () => {

    const validate = (payload: any) => findTaskType("coding")!.validatePayload(payload);

    it("accepts a payload with repoURL and issueURL only", () => {

        assert.deepStrictEqual(validate({ repoURL: "https://github.com/a/b.git", issueURL: "https://github.com/a/b/issues/1" }), []);
    });

    it("accepts a payload with a baseBranch", () => {

        assert.deepStrictEqual(validate({ repoURL: "r", issueURL: "i", baseBranch: "develop" }), []);
    });

    it("reports a missing repoURL and a missing issueURL", () => {

        assert.deepStrictEqual(validate({}), ["payload.repoURL is required", "payload.issueURL is required"]);
    });

    it("reports a blank repoURL", () => {

        assert.deepStrictEqual(validate({ repoURL: "   ", issueURL: "i" }), ["payload.repoURL must be a non-blank string"]);
    });

    it("reports a non-string issueURL", () => {

        assert.deepStrictEqual(validate({ repoURL: "r", issueURL: 42 }), ["payload.issueURL must be a non-blank string"]);
    });

    it("reports a blank baseBranch", () => {

        assert.deepStrictEqual(validate({ repoURL: "r", issueURL: "i", baseBranch: "" }), ["payload.baseBranch must be a non-blank string"]);
    });

    it("reports a null baseBranch, since a present baseBranch must be a string", () => {

        assert.deepStrictEqual(validate({ repoURL: "r", issueURL: "i", baseBranch: null }), ["payload.baseBranch must be a non-blank string"]);
    });

    it("reports unknown payload fields", () => {

        assert.deepStrictEqual(validate({ repoURL: "r", issueURL: "i", repoUrl: "x", branch: "main" }), ["Unknown field: payload.repoUrl", "Unknown field: payload.branch"]);
    });

    it("does not parse URLs", () => {

        assert.deepStrictEqual(validate({ repoURL: "not a url", issueURL: "also not a url" }), []);
    });
});

describe("coding task type - toTaskFile", () => {

    const toTaskFile = (taskId: string, payload: any) => findTaskType("coding")!.toTaskFile(taskId, payload);

    it("produces exactly agent-coder's TaskSpec, with baseBranch when provided", () => {

        const taskFile = toTaskFile("t-1", { repoURL: "r", issueURL: "i", baseBranch: "develop" });

        assert.deepStrictEqual(taskFile, { taskId: "t-1", repoURL: "r", issueURL: "i", baseBranch: "develop" });
    });

    it("omits baseBranch when it was not provided", () => {

        const taskFile = toTaskFile("t-1", { repoURL: "r", issueURL: "i" });

        assert.deepStrictEqual(taskFile, { taskId: "t-1", repoURL: "r", issueURL: "i" });
        assert.ok(!("baseBranch" in taskFile));
    });
});
