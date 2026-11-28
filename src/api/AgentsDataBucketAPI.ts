import { Storage } from "@google-cloud/storage";

/**
 * Client for the agents-data bucket (gs://{GCP_PID}-agents-data), where agents read their Task Files.
 * The only place in ape-tasks that talks to the bucket.
 */
export class AgentsDataBucketAPI {

    private bucketName: string;         // Name of the agents-data bucket: {projectId}-agents-data.
    private storage: Storage;           // GCS client.

    /**
     * @param {AgentsDataBucketAPIInput} input - the GCP project id and, optionally, the GCS client to use (defaults to a new Storage client)
     */
    constructor({ projectId, storage }: AgentsDataBucketAPIInput) {

        if (!projectId) throw new Error("No GCP project id provided: is the GCP_PID environment variable set?");

        this.bucketName = `${projectId}-agents-data`;
        this.storage = storage ?? new Storage();
    }

    /**
     * Writes a Task File as JSON to {bucketPrefix}/{taskId}/task.json.
     *
     * @param {WriteTaskFileInput} input - where to write the Task File and its content
     *
     * @returns {string} the gs:// URI of the written Task File
     */
    async writeTaskFile({ bucketPrefix, taskId, content }: WriteTaskFileInput): Promise<string> {

        const path = `${bucketPrefix}/${taskId}/task.json`;

        await this.storage.bucket(this.bucketName).file(path).save(JSON.stringify(content), { contentType: "application/json", resumable: false });

        return `gs://${this.bucketName}/${path}`;
    }
}

export interface AgentsDataBucketAPIInput {
    projectId: string;          // GCP project id (GCP_PID). The bucket is {projectId}-agents-data.
    storage?: Storage;          // Optional GCS client. Defaults to a new Storage client with application default credentials.
}

export interface WriteTaskFileInput {
    bucketPrefix: string;       // Folder of the agent in the bucket, e.g. "coder".
    taskId: string;             // Id of the task: the Task File goes under {bucketPrefix}/{taskId}/.
    content: any;               // Content of task.json, serialized as JSON.
}
