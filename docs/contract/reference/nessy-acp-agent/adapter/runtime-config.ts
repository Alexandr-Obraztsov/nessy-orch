import type { TPermissionResolveMethod } from '../../core/permission/types.js';

export type TAcpRuntimeConfig = {
    permissionResolveMethod?: TPermissionResolveMethod;
};

export function resolveAcpRuntimeConfig(env: NodeJS.ProcessEnv): TAcpRuntimeConfig {
    return {
        permissionResolveMethod:
            env.SESSION_PERMISSION_RESOLVE_METHOD?.trim() === 'extended' ? 'extended' : undefined,
    };
}
