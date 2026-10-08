export type TAcpClientCompatibility = {
    supportsSearchKind: boolean;
    supportsSearchLocations: boolean;
};

type TAcpClient = 'jetbrains-acp-ui' | 'unknown';

export function resolveAcpClient(userAgent: string | undefined): TAcpClient {
    const match = /^\s*([^/\s]+)(?:\/([^/\s]+))?\s*$/.exec(userAgent ?? '');

    return match?.[1].toLowerCase() === 'jetbrains-acp-ui' ? 'jetbrains-acp-ui' : 'unknown';
}

export function resolveAcpClientCompatibility(client: TAcpClient): TAcpClientCompatibility {
    if (client === 'jetbrains-acp-ui') {
        return {
            supportsSearchKind: false,
            supportsSearchLocations: false,
        };
    }

    return {
        supportsSearchKind: true,
        supportsSearchLocations: true,
    };
}
