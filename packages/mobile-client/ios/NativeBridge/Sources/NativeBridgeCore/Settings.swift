import Foundation

// Fork-only (sc-4643, native-settings-screen D1). What native Settings reads
// and the one save. Every value is loot-core's; Swift keeps none beyond the
// view model and validates nothing the engine owns. The contract is
// packages/loot-core/src/server/native/fixtures/settings.json.
public struct NativeSettings: Decodable, Equatable {
    public struct Flags: Decodable, Equatable { public let currency: Bool }
    public struct Budget: Decodable, Equatable {
        public let name: String?
        public let id: String?
        public let groupId: String?
    }
    public struct Encryption: Decodable, Equatable { public let enabled: Bool }
    public struct Server: Decodable, Equatable {
        public let url: String
        public let signedIn: Bool
    }
    public struct Sync: Decodable, Equatable { public let pending: Bool }
    public struct Limit: Decodable, Equatable {
        public let id: String
        public let value: Int
        public let defaultValue: Int
        // The smallest value a save accepts; 1 unless the limit sets one
        public let floor: Int
        public let ceiling: Int

        enum CodingKeys: String, CodingKey {
            case id, value, floor, ceiling
            case defaultValue = "default"
        }
    }

    // As web Settings stores them, keyed by preference id
    public let prefs: [String: String]
    public let flags: Flags
    public let budget: Budget
    public let encryption: Encryption
    // nil for a local-only budget
    public let server: Server?
    public let sync: Sync
    public let limits: [Limit]
    // Added by the page; absent when the page could not read it
    public let clientVersion: String?
}

// `native/server-info`: unreachable is an answer, not an error
public struct ServerInfo: Decodable, Equatable {
    public let reachable: Bool
    public let version: String?
}

public enum SettingValue: Encodable, Equatable {
    // A preference, as web Settings stores it
    case text(String)
    // A limit; nil resets it to its default (sent as null)
    case limit(Int?)

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .text(let value): try container.encode(value)
        case .limit(let value): try container.encode(value)
        }
    }
}

// `native/settings-save`: loot-core checks every key and value and writes all
// or nothing as one undo step
public struct SettingsSave: Encodable, Equatable {
    public let changes: [String: SettingValue]
    public let undoToken: String

    public init(changes: [String: SettingValue], undoToken: String = UUID().uuidString) throws {
        guard !changes.isEmpty else { throw NativeBridgeError.invalidWrite("changes") }
        guard !undoToken.isEmpty else { throw NativeBridgeError.invalidWrite("undoToken") }
        (self.changes, self.undoToken) = (changes, undoToken)
    }
}

extension NativeBridgeClient {
    public func settings() async throws -> NativeSettings {
        try JSONDecoder().decode(NativeSettings.self, from: await call("native/settings"))
    }

    public func serverInfo() async throws -> ServerInfo {
        try JSONDecoder().decode(ServerInfo.self, from: await call("native/server-info"))
    }

    public func saveSettings(_ save: SettingsSave) async throws {
        _ = try await call("native/settings-save", args: save)
    }
}
