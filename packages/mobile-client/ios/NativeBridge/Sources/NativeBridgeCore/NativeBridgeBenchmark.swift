import Foundation

// Fork-only (sc-3584). The latency benchmark for the ADR 11 gate: times
// `native/budget-month` round trips on the open budget, from the Swift call to
// the decoded result. Read-only: it goes through the allowlisted client and
// calls nothing else.
public struct BenchmarkStats: Equatable {
    public let count: Int
    public let medianMs: Double
    public let p95Ms: Double
    public let minMs: Double
    public let maxMs: Double

    public init(timesMs: [Double]) {
        let sorted = timesMs.sorted()
        // Nearest rank: the smallest value with at least p of the samples at or below it
        func rank(_ p: Double) -> Double {
            sorted.isEmpty ? 0 : sorted[max(0, Int((p * Double(sorted.count)).rounded(.up)) - 1)]
        }
        count = sorted.count
        medianMs = rank(0.5)
        p95Ms = rank(0.95)
        minMs = sorted.first ?? 0
        maxMs = sorted.last ?? 0
    }
}

public struct BenchmarkResult {
    public let month: String
    public let categories: Int
    public let bytes: Int
    public let stats: BenchmarkStats

    public var summary: String {
        func ms(_ v: Double) -> String { String(format: "%.1f ms", v) }
        return """
            Native bridge benchmark (sc-3584)
            Month \(month), \(categories) categories, \(bytes) bytes
            \(stats.count) round trips: median \(ms(stats.medianMs)), p95 \(ms(stats.p95Ms)), \
            min \(ms(stats.minMs)), max \(ms(stats.maxMs))
            Gate: under 50 ms
            """
    }
}

public enum NativeBridgeBenchmark {
    public static func currentMonth(_ date: Date = Date()) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM"
        return f.string(from: date)
    }

    public static func run(client: NativeBridgeClient, month: String, count: Int = 50, warmUp: Int = 5) async throws -> BenchmarkResult {
        for _ in 0..<warmUp { _ = try await client.budgetMonth(month) }
        var times: [Double] = []
        var categories = 0
        var bytes = 0
        for _ in 0..<count {
            let start = DispatchTime.now().uptimeNanoseconds
            let data = try await client.call("native/budget-month", args: ["month": month])
            let decoded = try JSONDecoder().decode(BudgetMonth.self, from: data)
            times.append(Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000)
            categories = decoded.groups.reduce(0) { $0 + $1.categories.count }
            bytes = data.count
        }
        return BenchmarkResult(month: month, categories: categories, bytes: bytes, stats: BenchmarkStats(timesMs: times))
    }
}
