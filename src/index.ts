import { getHyperscalerConfiguration, SupportedHyperscalers, TotoMicroservice, TotoMicroserviceConfiguration } from 'totoms';
import { ControllerConfig } from "./Config";
import { PostTask } from './dlg/PostTask';

const config: TotoMicroserviceConfiguration = {
    serviceName: "ape-tasks",
    basePath: '/apetasks',
    environment: {
        hyperscaler: process.env.HYPERSCALER as SupportedHyperscalers || "gcp",
        hyperscalerConfiguration: getHyperscalerConfiguration()
    },
    customConfiguration: ControllerConfig,
    apiConfiguration: {
        apiEndpoints: [
            { method: 'POST', path: '/tasks', delegate: PostTask },
        ],
        apiOptions: { noCorrelationId: true }
    },
    messageBusConfiguration: {
        topics: [
            // Logical names must match the `topic` of the entries in src/util/TaskTypes.ts. The secret holds the Pub/Sub topic name (nicolasances/toto-terra#59).
            { logicalName: "agentCoderTasks", secret: "agent_coder_tasks_topic_name" },
        ],
    },
};

TotoMicroservice.init(config).then(microservice => {
    microservice.start();
});
