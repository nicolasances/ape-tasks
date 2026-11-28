import { randomUUID } from "crypto";
import { Request } from "express";
import { MessageDestination, TotoControllerConfig, TotoDelegate, TotoMessage, TotoMessageBus, UserContext, ValidationError } from "totoms";
import { AgentsDataBucketAPI } from "../api/AgentsDataBucketAPI";
import { EVENTS } from "../evt/Events";
import { findTaskType, supportedTaskTypes } from "../util/TaskTypes";

const ALLOWED_ENVELOPE_FIELDS = ["type", "payload"];
const TASK_REQUESTED = EVENTS.taskRequested;

/**
 * POST /tasks: starts an agent task.
 *
 * The request says which kind of task it is (type) and carries the task-specific data (payload).
 * See docs/features/post-tasks.md.
 */
export class PostTask extends TotoDelegate<PostTaskRequest, PostTaskResponse> {

    private bucketAPI?: AgentsDataBucketAPI;        // Client for the agents-data bucket. Created on first use unless one is injected.

    /**
     * The constructor signature is dictated by totoms, which instantiates delegates with (messageBus, config).
     *
     * @param {TotoMessageBus} messageBus - the totoms message bus, used to publish the Task Message
     * @param {TotoControllerConfig} config - the service configuration
     * @param {AgentsDataBucketAPI} bucketAPI - optional client for the agents-data bucket. Defaults to one built from the GCP_PID environment variable.
     */
    constructor(messageBus: TotoMessageBus, config: TotoControllerConfig, bucketAPI?: AgentsDataBucketAPI) {

        super(messageBus, config);

        this.bucketAPI = bucketAPI;
    }

    /**
     * Starts the task.
     *
     * Steps:
     * - mints a taskId
     * - writes the Task File to the agents-data bucket, under the task type's prefix
     * - only then publishes the Task Message (type taskRequested, data { taskId }) on the task type's topic
     *
     * If the Task File write fails, the error propagates (500) and nothing is published.
     * Known gap: totoms 2.5.0 swallows publish errors, so a failed publish still returns success.
     *
     * @param {PostTaskRequest} req - the validated request
     * @param {UserContext} userContext - the caller
     *
     * @returns {PostTaskResponse} the minted taskId and the location of the Task File
     */
    async do(req: PostTaskRequest, userContext?: UserContext): Promise<PostTaskResponse> {

        const taskType = findTaskType(req.type)!;
        const taskId = randomUUID();

        const taskFile = await this.getBucketAPI().writeTaskFile({ bucketPrefix: taskType.bucketPrefix, taskId, content: taskType.toTaskFile(taskId, req.payload) });

        const message: TotoMessage = { timestamp: new Date().toISOString(), cid: this.cid ?? taskId, id: taskId, type: TASK_REQUESTED, msg: `Task ${taskId} of type ${req.type} requested`, data: { taskId } };

        await this.messageBus.publishMessage(new MessageDestination({ topic: taskType.topic }), message);

        return { taskId, taskFile };
    }

    /**
     * Returns the agents-data bucket client, creating it from GCP_PID on first use.
     * Created lazily so that a missing GCP_PID fails the request rather than the service start.
     *
     * @returns {AgentsDataBucketAPI} the bucket client
     */
    private getBucketAPI(): AgentsDataBucketAPI {

        if (!this.bucketAPI) this.bucketAPI = new AgentsDataBucketAPI({ projectId: process.env.GCP_PID ?? "" });

        return this.bucketAPI;
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
