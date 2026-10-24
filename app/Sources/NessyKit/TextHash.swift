import CryptoKit
import Foundation

/// Хэши текстов для сверки с сервером.
public enum TextHash {
	/// sha1 в hex от UTF-8 строки: `base` описания кейса (совпадает с `summaryHash` сервера).
	public static func sha1(_ s: String) -> String {
		Insecure.SHA1.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
	}
}
