import { Request } from "express";
import { TotoDelegate, UserContext, ValidationError } from "totoms";
import { findTaskType, supportedTaskTypes } from "../util/TaskTypes";

const ALLOWED_ENVELOPE_FIELDS = ["type", "payload"];

/**
 * POST /tasks: starts an agent task.
 *
 * The request says which kind of task it is (type) and carries the task-specific data (payload).
 * See docs/features/post-tasks.md.
 */
export class PostTask extends TotoDelegate<PostTaskRequest, PostTaskResponse> {

    /**
     * Starts the task.
     *
     * @param {PostTaskRequest} req - the validated request
     * @param {UserContext} userContext - the caller
     *
     * @returns {PostTaskResponse} the minted taskId and the location of the Task File
     */
    async do(req: PostTaskRequest, userContext?: UserContext): Promise<PostTaskResponse> {

        throw new Error("Not implemented");
    }

    /**
     * Validates the request envelope and the payload, and extracts them.
     *
     * Rules:
     * - type and payload are required, payload must be an object. Other top-level fields are rejected.
     * - type must be a supported task type. If it isn't, the payload is not validated.
     * - the payload is validated by the task type's validator.
     * - all problems are reported together in one ValidationError (400).
     *
     * @param {Request} req - the HTTP request
     *
     * @returns {PostTaskRequest} the validated type and payload
     */
    parseRequest(req: Request): PostTaskRequest {

        const body = req.body ?? {};
        const type = body.type;
        const payload = body.payload;

        const problems: string[] = [];

        if (type === undefined) problems.push("type is required");
        else if (typeof type !== "string") problems.push("type must be a string");

        const isPayloadObject = typeof payload === "object" && payload !== null && !Array.isArray(payload);

        if (!isPayloadObject) problems.push("payload is required and must be an object");

        for (const field of Object.keys(body)) {
            if (!ALLOWED_ENVELOPE_FIELDS.includes(field)) problems.push(`Unknown field: ${field}`);
        }

        if (typeof type === "string") {

            const taskType = findTaskType(type);

            if (!taskType) problems.push(`Unsupported task type "${type}". Supported types: ${supportedTaskTypes().join(", ")}`);
            else if (isPayloadObject) problems.push(...taskType.validatePayload(payload));
        }

        if (problems.length > 0) throw new ValidationError(400, `Invalid request: ${problems.join("; ")}`);

        return { type, payload };
    }
}

interface PostTaskRequest {
    type: string;           // The task type, e.g. "coding". Always a supported type once parsed.
    payload: any;           // The task-specific data, validated against the task type's rules.
}

interface PostTaskResponse {
    taskId: string;         // The id minted for the task.
    taskFile: string;       // The gs:// URI of the Task File written for the agent.
}
