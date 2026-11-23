import { APIOptions, TotoControllerConfig } from 'totoms';

export class ControllerConfig extends TotoControllerConfig {

    getMongoSecretNames(): { userSecretName: string; pwdSecretName: string; } | null {
        return null;
    }

    getProps(): APIOptions {
        return {}
    }

}
