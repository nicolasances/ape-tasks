/**
 * Describes how a task type is routed to its agent and how its payload is validated.
 */
export interface TaskType {
    bucketPrefix: string;                                       // Folder in the agents-data bucket where the agent reads its Task Files (e.g. "coder").
    topic: string;                                              // Logical name of the topic the Task Message is published on. Must match a topic in messageBusConfiguration.topics.
    validatePayload: (payload: any) => string[];                // Validates the request payload. Returns the list of problems, empty if the payload is valid.
    toTaskFile: (taskId: string, payload: any) => any;          // Builds the content of the Task File (task.json) from the minted taskId and a valid payload.
}

/**
 * Content of the Task File for a coding task. Exactly agent-coder's TaskSpec.
 */
export interface CodingTaskFile {
    taskId: string;             // Id of the task, minted by ape-tasks.
    repoURL: string;            // URL of the repository agent-coder works on.
    issueURL: string;           // URL of the GitHub issue agent-coder implements.
    baseBranch?: string;        // Branch to start from. Absent when not provided: agent-coder then defaults to main.
}

const CODING_REQUIRED_FIELDS = ["repoURL", "issueURL"];
const CODING_OPTIONAL_FIELDS = ["baseBranch"];

/**
 * Checks whether a value is a string with at least one non-whitespace character.
 *
 * @param {any} value - the value to check
 *
 * @returns {boolean} true if the value is a non-blank string
 */
function isNonBlankString(value: any): boolean {

    return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validates the payload of a coding task.
 *
 * Rules:
 * - repoURL and issueURL are required non-blank strings. URLs are not parsed.
 * - baseBranch is optional, but must be a non-blank string if present.
 * - Any other field is rejected.
 *
 * @param {any} payload - the payload object of the request
 *
 * @returns {string[]} the list of problems, empty if the payload is valid
 */
function validateCodingPayload(payload: any): string[] {

    const problems: string[] = [];

    for (const field of CODING_REQUIRED_FIELDS) {
        if (!(field in payload)) problems.push(`payload.${field} is required`);
        else if (!isNonBlankString(payload[field])) problems.push(`payload.${field} must be a non-blank string`);
    }

    for (const field of CODING_OPTIONAL_FIELDS) {
        if (field in payload && !isNonBlankString(payload[field])) problems.push(`payload.${field} must be a non-blank string`);
    }

    const allowedFields = [...CODING_REQUIRED_FIELDS, ...CODING_OPTIONAL_FIELDS];

    for (const field of Object.keys(payload)) {
        if (!allowedFields.includes(field)) problems.push(`Unknown field: payload.${field}`);
    }

    return problems;
}

/**
 * Builds the Task File of a coding task: agent-coder's TaskSpec, nothing added, nothing renamed.
 *
 * @param {string} taskId - the minted id of the task
 * @param {any} payload - a valid coding payload
 *
 * @returns {CodingTaskFile} the content of task.json
 */
function toCodingTaskFile(taskId: string, payload: any): CodingTaskFile {

    const taskFile: CodingTaskFile = { taskId, repoURL: payload.repoURL, issueURL: payload.issueURL };

    if (payload.baseBranch !== undefined) taskFile.baseBranch = payload.baseBranch;

    return taskFile;
}

/**
 * The task-type registry: maps a task type to its routing and validation.
 * Adding an agent means adding an entry here and its topic in the message bus configuration.
 */
const TASK_TYPES: { [type: string]: TaskType } = {
    coding: {
        bucketPrefix: "coder",
        topic: "agentCoderTasks",
        validatePayload: validateCodingPayload,
        toTaskFile: toCodingTaskFile,
    },
};

/**
 * Looks up a task type in the registry.
 *
 * @param {string} type - the task type, as sent in the request
 *
 * @returns {TaskType | undefined} the task type, or undefined if it is not supported
 */
export function findTaskType(type: string): TaskType | undefined {

    if (!Object.prototype.hasOwnProperty.call(TASK_TYPES, type)) return undefined;

    return TASK_TYPES[type];
}

/**
 * Lists the supported task types.
 *
 * @returns {string[]} the names of the supported task types
 */
export function supportedTaskTypes(): string[] {

    return Object.keys(TASK_TYPES);
}
