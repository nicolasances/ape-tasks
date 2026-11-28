import assert from "assert";
import { Request } from "express";
import { TotoControllerConfig, TotoMessageBus, ValidationError } from "totoms";
import { PostTask } from "../../src/dlg/PostTask";

/**
 * Builds a PostTask delegate for parseRequest tests: neither the message bus nor the config are used by parseRequest.
 */
function newDelegate(): PostTask {

    return new PostTask({} as TotoMessageBus, {} as TotoControllerConfig);
}

/**
 * Runs parseRequest on the given body and returns the ValidationError it throws. Fails the test if nothing is thrown.
 */
function parseError(body: any): ValidationError {

    try {
        newDelegate().parseRequest({ body } as Request);
    } catch (error) {
        assert.ok(error instanceof ValidationError, `Expected a ValidationError, got ${error}`);

        return error;
    }

    assert.fail("Expected parseRequest to throw a ValidationError");
}

describe("PostTask.parseRequest", () => {

    it("returns the type and payload of a valid coding request", () => {

        const body = { type: "coding", payload: { repoURL: "r", issueURL: "i", baseBranch: "main" } };

        const request = newDelegate().parseRequest({ body } as Request);

        assert.deepStrictEqual(request, { type: "coding", payload: { repoURL: "r", issueURL: "i", baseBranch: "main" } });
    });

    it("rejects a missing type with 400", () => {

        const error = parseError({ payload: { repoURL: "r", issueURL: "i" } });

        assert.strictEqual(error.code, 400);
        assert.strictEqual(error.message, "Invalid request: type is required");
    });

    it("rejects a non-string type", () => {

        const error = parseError({ type: 7, payload: { repoURL: "r", issueURL: "i" } });

        assert.strictEqual(error.message, "Invalid request: type must be a string");
    });

    it("rejects an unsupported type, naming the supported types", () => {

        const error = parseError({ type: "review", payload: { repoURL: "r", issueURL: "i" } });

        assert.strictEqual(error.code, 400);
        assert.strictEqual(error.message, 'Invalid request: Unsupported task type "review". Supported types: coding');
    });

    it("does not validate the payload of an unsupported type", () => {

        const error = parseError({ type: "review", payload: { anything: true } });

        assert.strictEqual(error.message, 'Invalid request: Unsupported task type "review". Supported types: coding');
    });

    it("rejects a missing payload", () => {

        const error = parseError({ type: "coding" });

        assert.strictEqual(error.message, "Invalid request: payload is required and must be an object");
    });

    it("rejects a payload that is an array", () => {

        const error = parseError({ type: "coding", payload: [] });

        assert.strictEqual(error.message, "Invalid request: payload is required and must be an object");
    });

    it("rejects a payload that is null", () => {

        const error = parseError({ type: "coding", payload: null });

        assert.strictEqual(error.message, "Invalid request: payload is required and must be an object");
    });

    it("rejects unknown top-level fields", () => {

        const error = parseError({ type: "coding", payload: { repoURL: "r", issueURL: "i" }, priority: "high" });

        assert.strictEqual(error.message, "Invalid request: Unknown field: priority");
    });

    it("rejects a missing body as missing type and payload", () => {

        const error = parseError(undefined);

        assert.strictEqual(error.message, "Invalid request: type is required; payload is required and must be an object");
    });

    it("reports all envelope and payload problems in one error", () => {

        const error = parseError({ type: "coding", payload: { branch: "main" }, extra: 1 });

        assert.strictEqual(error.message, "Invalid request: Unknown field: extra; payload.repoURL is required; payload.issueURL is required; Unknown field: payload.branch");
    });

    it("reports envelope problems together with an unsupported type", () => {

        const error = parseError({ type: "review", payload: {}, extra: 1 });

        assert.strictEqual(error.message, 'Invalid request: Unknown field: extra; Unsupported task type "review". Supported types: coding');
    });
});
