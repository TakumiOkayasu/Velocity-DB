#pragma once

#include <expected>
#include <string>
#include <string_view>
#include <vector>

namespace predategrip {

/// Utility class for encrypting/decrypting credentials using Windows DPAPI.
/// DPAPI binds encryption to the current user, so encrypted data can only
/// be decrypted by the same user on the same machine.
class CredentialProtector {
public:
    /// Encrypt plaintext password using DPAPI
    /// @param plaintext The password to encrypt
    /// @return Base64-encoded encrypted data, or error message
    [[nodiscard]] static std::expected<std::string, std::string> encrypt(std::string_view plaintext);

    /// Decrypt password that was encrypted with encrypt()
    /// @param encryptedBase64 Base64-encoded encrypted data from encrypt()
    /// @return Decrypted plaintext password, or error message
    [[nodiscard]] static std::expected<std::string, std::string> decrypt(std::string_view encryptedBase64);

private:
    [[nodiscard]] static std::string base64Encode(const std::vector<unsigned char>& data);
    [[nodiscard]] static std::expected<std::vector<unsigned char>, std::string> base64Decode(std::string_view encoded);
};

}  // namespace predategrip
