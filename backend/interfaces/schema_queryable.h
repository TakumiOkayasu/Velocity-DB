#pragma once

#include <string>
#include <string_view>

namespace velocitydb {

/// ISP: Schema introspection query interface
class ISchemaQueryable {
public:
    virtual ~ISchemaQueryable() = default;

    ISchemaQueryable(const ISchemaQueryable&) = delete;
    ISchemaQueryable& operator=(const ISchemaQueryable&) = delete;

    [[nodiscard]] virtual std::string getDatabasesQuery() const = 0;
    [[nodiscard]] virtual std::string getTablesQuery() const = 0;
    [[nodiscard]] virtual std::string getColumnsQuery(std::string_view schema, std::string_view table) const = 0;
    /// 全ユーザテーブル/ビューの列定義を 1 クエリで返す (#512: テーブル毎の N+1 往復解消)。
    /// 行レイアウト: [0]=schema, [1]=table, [2]=column_name, [3]=data_type, [4]=size,
    /// [5]=is_nullable, [6]=is_primary_key, [7]=comment。schema, table, 列順でソート済みであること
    [[nodiscard]] virtual std::string getAllColumnsQuery() const = 0;
    [[nodiscard]] virtual std::string getTableMetadataQuery(std::string_view schema, std::string_view table) const = 0;

protected:
    ISchemaQueryable() = default;
};

}  // namespace velocitydb
