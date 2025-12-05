#include "credential_protector.h"

#include <Windows.h>

#include <array>
#include <vector>

#include <wincrypt.h>

#pragma comment(lib, "crypt32.lib")

namespace predategrip {

std::expected<std::string, std::string> CredentialProtector::encrypt(std::string_view plaintext) {
    if (plaintext.empty()) {
        return std::string{};  // Empty password returns empty string
    }

    DATA_BLOB inputBlob;
    inputBlob.pbData = reinterpret_cast<BYTE*>(const_cast<char*>(plaintext.data()));
    inputBlob.cbData = static_cast<DWORD>(plaintext.size());

    DATA_BLOB outputBlob;
    outputBlob.pbData = nullptr;
    outputBlob.cbData = 0;

    // CRYPTPROTECT_LOCAL_MACHINE is NOT set, so only current user can decrypt
    if (!CryptProtectData(&inputBlob, nullptr, nullptr, nullptr, nullptr, 0, &outputBlob)) [[unlikely]] {
        return std::unexpected("Failed to encrypt data: DPAPI error " + std::to_string(GetLastError()));
    }

    std::vector<unsigned char> encrypted(outputBlob.pbData, outputBlob.pbData + outputBlob.cbData);
    LocalFree(outputBlob.pbData);

    return base64Encode(encrypted);
}

std::expected<std::string, std::string> CredentialProtector::decrypt(std::string_view encryptedBase64) {
    if (encryptedBase64.empty()) {
        return std::string{};  // Empty encrypted string returns empty password
    }

    auto decodedResult = base64Decode(encryptedBase64);
    if (!decodedResult) {
        return std::unexpected(decodedResult.error());
    }

    const auto& encrypted = decodedResult.value();

    DATA_BLOB inputBlob;
    inputBlob.pbData = const_cast<BYTE*>(encrypted.data());
    inputBlob.cbData = static_cast<DWORD>(encrypted.size());

    DATA_BLOB outputBlob;
    outputBlob.pbData = nullptr;
    outputBlob.cbData = 0;

    if (!CryptUnprotectData(&inputBlob, nullptr, nullptr, nullptr, nullptr, 0, &outputBlob)) [[unlikely]] {
        return std::unexpected("Failed to decrypt data: DPAPI error " + std::to_string(GetLastError()));
    }

    std::string decrypted(reinterpret_cast<char*>(outputBlob.pbData), outputBlob.cbData);
    SecureZeroMemory(outputBlob.pbData, outputBlob.cbData);  // Clear sensitive data before freeing
    LocalFree(outputBlob.pbData);

    return decrypted;
}

std::string CredentialProtector::base64Encode(const std::vector<unsigned char>& data) {
    if (data.empty()) {
        return {};
    }

    DWORD encodedSize = 0;
    CryptBinaryToStringA(data.data(), static_cast<DWORD>(data.size()), CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, nullptr, &encodedSize);

    std::string encoded(encodedSize, '\0');
    CryptBinaryToStringA(data.data(), static_cast<DWORD>(data.size()), CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, encoded.data(), &encodedSize);

    // Remove trailing null if present
    while (!encoded.empty() && encoded.back() == '\0') {
        encoded.pop_back();
    }

    return encoded;
}

std::expected<std::vector<unsigned char>, std::string> CredentialProtector::base64Decode(std::string_view encoded) {
    if (encoded.empty()) {
        return std::vector<unsigned char>{};
    }

    DWORD decodedSize = 0;
    if (!CryptStringToBinaryA(encoded.data(), static_cast<DWORD>(encoded.size()), CRYPT_STRING_BASE64, nullptr, &decodedSize, nullptr, nullptr)) [[unlikely]] {
        return std::unexpected("Invalid base64 encoding");
    }

    std::vector<unsigned char> decoded(decodedSize);
    if (!CryptStringToBinaryA(encoded.data(), static_cast<DWORD>(encoded.size()), CRYPT_STRING_BASE64, decoded.data(), &decodedSize, nullptr, nullptr)) [[unlikely]] {
        return std::unexpected("Failed to decode base64 data");
    }

    decoded.resize(decodedSize);
    return decoded;
}

}  // namespace predategrip
