#include <gtest/gtest.h>
#include "parsers/a5er_parser.h"
#include "parsers/er_diagram_parser_factory.h"
#include "interfaces/parsers/er_model.h"

namespace velocitydb {
namespace test {

// ============================================================
// Test data
// ============================================================

static const char* BASIC_TEXT_INPUT = R"a5er(# A5:ER FORMAT:19
# A5:ER ENCODING:UTF-8

[Entity]
PName=users
LName=User
Comment=User master
Page=MAIN
Left=100
Top=200
Color=$000000
BkColor=$99FFFF
Field="id","id","INT","NOT NULL",0,"",""
Field="name","display_name","NVARCHAR(100)","NOT NULL","","","","$000099FF"
Field="email","email_addr","NVARCHAR(255)","NULL","","",""
DEL

[Entity]
PName=orders
LName=Order
Comment=
Page=MAIN
Left=400
Top=200
Field="id","id","INT","NOT NULL",0,"",""
Field="user_id","user_ref","INT","NOT NULL","","",""
Field="amount","price","DECIMAL(10,2)","NOT NULL","","0",""
DEL

[Relation]
Entity1=users
Entity2=orders
RelationType1=2
RelationType2=3
Fields1=id
Fields2=user_id
Dependence=0
DEL

[Shape]
ShapeType=RoundRect
Text=User Group
BrushColor=$E8FFFF
FontColor=$000000
BrushAlpha=200
FontSize=12
Left=50
Top=30
Width=500
Height=400
Page=MAIN
DEL
)a5er";

static const char* XML_INPUT = R"xml(<?xml version="1.0" encoding="UTF-8"?>
<A5ER Name="TestModel" DatabaseType="SQLServer">
  <Entity Name="products" LogicalName="Product" Comment="Product master" Page="MAIN" X="100" Y="200" Color="$FF0000" BkColor="$00FF00">
    <Attribute Name="id" LogicalName="ID" Type="INT" Nullable="false" PK="true"/>
    <Attribute Name="name" LogicalName="ProductName" Type="NVARCHAR" Size="200" Nullable="false"/>
    <Index Name="IX_products_name" Unique="false" Columns="name"/>
  </Entity>
  <Relation Name="FK_orders_products" ParentEntity="products" ChildEntity="orders" ParentAttribute="id" ChildAttribute="product_id" Cardinality="1:N"/>
</A5ER>)xml";

// ============================================================
// IERDiagramParser interface tests (primary API)
// ============================================================

class ERDiagramParserTest : public ::testing::Test {
protected:
    A5ERParser parser;
};

TEST_F(ERDiagramParserTest, Extensions) {
    auto exts = parser.extensions();
    ASSERT_EQ(exts.size(), 1);
    EXPECT_EQ(exts[0], ".a5er");
}

TEST_F(ERDiagramParserTest, CanParseTextFormat) {
    EXPECT_TRUE(parser.canParse("# A5:ER FORMAT:19\n[Entity]\nPName=t\nDEL\n"));
}

TEST_F(ERDiagramParserTest, CanParseXmlFormat) {
    EXPECT_TRUE(parser.canParse("<?xml version=\"1.0\"?><A5ER Name=\"test\"></A5ER>"));
}

TEST_F(ERDiagramParserTest, CanParseRejectsUnknown) {
    EXPECT_FALSE(parser.canParse("random content without markers"));
    EXPECT_FALSE(parser.canParse("CREATE TABLE foo (id INT);"));
    // INI形式の[Entity]だけではA5:ERと判定しない
    EXPECT_FALSE(parser.canParse("[Entity]\nPName=test\nDEL\n"));
}

// --- Text format → ERModel ---

TEST_F(ERDiagramParserTest, TextFormatBasicStructure) {
    ERModel model = parser.parse(std::string(BASIC_TEXT_INPUT));

    EXPECT_EQ(model.tables.size(), 2);
    EXPECT_EQ(model.relations.size(), 1);
    EXPECT_EQ(model.shapes.size(), 1);
}

TEST_F(ERDiagramParserTest, TextFormatTableProperties) {
    ERModel model = parser.parse(std::string(BASIC_TEXT_INPUT));
    const auto& users = model.tables[0];

    EXPECT_EQ(users.name, "users");
    EXPECT_EQ(users.logicalName, "User");
    EXPECT_EQ(users.comment, "User master");
    EXPECT_EQ(users.page, "MAIN");
    EXPECT_EQ(users.posX, 100.0);
    EXPECT_EQ(users.posY, 200.0);
}

TEST_F(ERDiagramParserTest, TextFormatColumns) {
    ERModel model = parser.parse(std::string(BASIC_TEXT_INPUT));
    const auto& cols = model.tables[0].columns;

    ASSERT_EQ(cols.size(), 3);

    EXPECT_EQ(cols[0].name, "id");
    EXPECT_EQ(cols[0].logicalName, "id");
    EXPECT_EQ(cols[0].type, "INT");
    EXPECT_FALSE(cols[0].nullable);
    EXPECT_TRUE(cols[0].isPrimaryKey);

    EXPECT_EQ(cols[1].name, "name");
    EXPECT_EQ(cols[1].logicalName, "display_name");
    EXPECT_EQ(cols[1].type, "NVARCHAR(100)");
    EXPECT_FALSE(cols[1].nullable);
    EXPECT_FALSE(cols[1].isPrimaryKey);

    EXPECT_EQ(cols[2].name, "email");
    EXPECT_TRUE(cols[2].nullable);
}

TEST_F(ERDiagramParserTest, TextFormatDefaultValues) {
    ERModel model = parser.parse(std::string(BASIC_TEXT_INPUT));
    const auto& orders = model.tables[1];

    EXPECT_EQ(orders.columns[2].defaultValue, "0");
    EXPECT_EQ(orders.columns[0].defaultValue, "");
}

TEST_F(ERDiagramParserTest, TextFormatRelation) {
    ERModel model = parser.parse(std::string(BASIC_TEXT_INPUT));

    ASSERT_EQ(model.relations.size(), 1);
    const auto& rel = model.relations[0];

    EXPECT_EQ(rel.parentTable, "users");
    EXPECT_EQ(rel.childTable, "orders");
    EXPECT_EQ(rel.parentColumn, "id");
    EXPECT_EQ(rel.childColumn, "user_id");
    EXPECT_EQ(rel.cardinality, "1:N");
}

TEST_F(ERDiagramParserTest, TextFormatColorConversion) {
    ERModel model = parser.parse(std::string(BASIC_TEXT_INPUT));
    const auto& users = model.tables[0];

    // $BBGGRR → #RRGGBB
    EXPECT_EQ(users.color, "#000000");
    EXPECT_EQ(users.bkColor, "#FFFF99");

    // Column: $AABBGGRR → #RRGGBB (alpha stripped)
    EXPECT_EQ(users.columns[1].color, "#FF9900");

    // No color → empty
    EXPECT_EQ(users.columns[2].color, "");

    // orders: no Color/BkColor properties
    EXPECT_EQ(model.tables[1].color, "");
    EXPECT_EQ(model.tables[1].bkColor, "");
}

TEST_F(ERDiagramParserTest, TextFormatShapeConversion) {
    ERModel model = parser.parse(std::string(BASIC_TEXT_INPUT));

    ASSERT_EQ(model.shapes.size(), 1);
    const auto& shape = model.shapes[0];

    EXPECT_EQ(shape.shapeType, "roundrect");  // Normalized to lowercase
    EXPECT_EQ(shape.text, "User Group");
    EXPECT_EQ(shape.fillColor, "#FFFFE8");    // $BBGGRR → #RRGGBB
    EXPECT_EQ(shape.fontColor, "#000000");
    EXPECT_EQ(shape.fillAlpha, 200);
    EXPECT_EQ(shape.fontSize, 12);
    EXPECT_EQ(shape.left, 50.0);
    EXPECT_EQ(shape.top, 30.0);
    EXPECT_EQ(shape.width, 500.0);
    EXPECT_EQ(shape.height, 400.0);
    EXPECT_EQ(shape.page, "MAIN");
}

// --- XML format → ERModel ---

TEST_F(ERDiagramParserTest, XmlFormatBasicStructure) {
    ERModel model = parser.parse(std::string(XML_INPUT));

    EXPECT_EQ(model.name, "TestModel");
    EXPECT_EQ(model.databaseType, "SQLServer");
    EXPECT_EQ(model.tables.size(), 1);
    EXPECT_EQ(model.relations.size(), 1);
}

TEST_F(ERDiagramParserTest, XmlFormatTableProperties) {
    ERModel model = parser.parse(std::string(XML_INPUT));
    const auto& products = model.tables[0];

    EXPECT_EQ(products.name, "products");
    EXPECT_EQ(products.logicalName, "Product");
    EXPECT_EQ(products.comment, "Product master");
    EXPECT_EQ(products.page, "MAIN");
    EXPECT_EQ(products.posX, 100.0);
    EXPECT_EQ(products.posY, 200.0);
}

TEST_F(ERDiagramParserTest, XmlFormatColumns) {
    ERModel model = parser.parse(std::string(XML_INPUT));
    const auto& cols = model.tables[0].columns;

    ASSERT_EQ(cols.size(), 2);
    EXPECT_EQ(cols[0].name, "id");
    EXPECT_TRUE(cols[0].isPrimaryKey);
    EXPECT_FALSE(cols[0].nullable);

    EXPECT_EQ(cols[1].name, "name");
    EXPECT_EQ(cols[1].logicalName, "ProductName");
    EXPECT_EQ(cols[1].size, 200);
}

TEST_F(ERDiagramParserTest, XmlFormatIndexes) {
    ERModel model = parser.parse(std::string(XML_INPUT));
    const auto& idxs = model.tables[0].indexes;

    ASSERT_EQ(idxs.size(), 1);
    EXPECT_EQ(idxs[0].name, "IX_products_name");
    EXPECT_FALSE(idxs[0].isUnique);
    ASSERT_EQ(idxs[0].columns.size(), 1);
    EXPECT_EQ(idxs[0].columns[0], "name");
}

TEST_F(ERDiagramParserTest, XmlFormatRelation) {
    ERModel model = parser.parse(std::string(XML_INPUT));
    const auto& rel = model.relations[0];

    EXPECT_EQ(rel.name, "FK_orders_products");
    EXPECT_EQ(rel.parentTable, "products");
    EXPECT_EQ(rel.childTable, "orders");
    EXPECT_EQ(rel.cardinality, "1:N");
}

// --- DDL generation via ERModel ---

TEST_F(ERDiagramParserTest, GenerateDDLFromERModel) {
    ERModel model = parser.parse(std::string(BASIC_TEXT_INPUT));
    std::string ddl = parser.generateDDL(model);

    EXPECT_NE(ddl.find("CREATE TABLE [users]"), std::string::npos);
    EXPECT_NE(ddl.find("CREATE TABLE [orders]"), std::string::npos);
    EXPECT_NE(ddl.find("[id]"), std::string::npos);
    EXPECT_NE(ddl.find("PRIMARY KEY"), std::string::npos);
    EXPECT_NE(ddl.find("FOREIGN KEY"), std::string::npos);
}

TEST_F(ERDiagramParserTest, GenerateDDLTypeMapping) {
    ERModel model;
    ERModelTable table;
    table.name = "TestTypes";

    ERModelColumn col1;
    col1.name = "text_col";
    col1.type = "string";
    col1.size = 50;
    table.columns.push_back(col1);

    ERModelColumn col2;
    col2.name = "int_col";
    col2.type = "integer";
    table.columns.push_back(col2);

    model.tables.push_back(table);

    std::string ddl = parser.generateDDL(model);
    EXPECT_NE(ddl.find("NVARCHAR(50)"), std::string::npos);
    EXPECT_NE(ddl.find("INT"), std::string::npos);
}

TEST_F(ERDiagramParserTest, GenerateDDLIndexes) {
    ERModel model;
    ERModelTable table;
    table.name = "Users";

    ERModelColumn col;
    col.name = "email";
    col.type = "VARCHAR";
    col.size = 255;
    table.columns.push_back(col);

    ERModelIndex idx;
    idx.name = "IX_Users_Email";
    idx.columns.push_back("email");
    idx.isUnique = true;
    table.indexes.push_back(idx);

    model.tables.push_back(table);

    std::string ddl = parser.generateDDL(model);
    EXPECT_NE(ddl.find("CREATE UNIQUE INDEX"), std::string::npos);
    EXPECT_NE(ddl.find("[IX_Users_Email]"), std::string::npos);
}

// ============================================================
// Text format edge cases
// ============================================================

TEST_F(ERDiagramParserTest, TextFormatCardinalityConversions) {
    auto makeInput = [](int type1, int type2) {
        return "# A5:ER FORMAT:19\n"
               "[Entity]\nPName=a\nLName=A\nField=\"id\",\"id\",\"INT\",\"NOT NULL\",0,\"\",\"\"\nDEL\n"
               "[Entity]\nPName=b\nLName=B\nField=\"id\",\"id\",\"INT\",\"NOT NULL\",0,\"\",\"\"\nDEL\n"
               "[Relation]\nEntity1=a\nEntity2=b\nRelationType1=" +
               std::to_string(type1) + "\nRelationType2=" + std::to_string(type2) + "\nFields1=id\nFields2=id\nDEL\n";
    };

    auto cardinality = [&](int t1, int t2) { return parser.parse(makeInput(t1, t2)).relations[0].cardinality; };

    // 1:N combinations
    EXPECT_EQ(cardinality(2, 3), "1:N");
    EXPECT_EQ(cardinality(2, 4), "1:N");
    EXPECT_EQ(cardinality(3, 2), "1:N");

    // 1:1 combinations
    EXPECT_EQ(cardinality(2, 2), "1:1");
    EXPECT_EQ(cardinality(1, 2), "1:1");

    // N:M combinations
    EXPECT_EQ(cardinality(3, 3), "N:M");
    EXPECT_EQ(cardinality(4, 4), "N:M");
    EXPECT_EQ(cardinality(3, 4), "N:M");
}

TEST_F(ERDiagramParserTest, TextFormatMultiplePages) {
    const char* input = R"a5er(# A5:ER FORMAT:19

[Entity]
PName=users
LName=User
Page=MAIN
Field="id","id","INT","NOT NULL",0,"",""
DEL

[Entity]
PName=logs
LName=Log
Page=SUB
Field="id","id","INT","NOT NULL",0,"",""
DEL

[Entity]
PName=orders
LName=Order
Page=MAIN
Field="id","id","INT","NOT NULL",0,"",""
DEL
)a5er";
    ERModel model = parser.parse(std::string(input));

    ASSERT_EQ(model.tables.size(), 3);
    EXPECT_EQ(model.tables[0].page, "MAIN");
    EXPECT_EQ(model.tables[1].page, "SUB");
    EXPECT_EQ(model.tables[2].page, "MAIN");
}

TEST_F(ERDiagramParserTest, TextFormatEmptyPage) {
    ERModel model = parser.parse("# A5:ER FORMAT:19\n\n[Entity]\nPName=test\nLName=Test\nDEL\n");

    ASSERT_EQ(model.tables.size(), 1);
    EXPECT_EQ(model.tables[0].page, "");
}

TEST_F(ERDiagramParserTest, TextFormatIndexes) {
    const char* input = R"a5er(# A5:ER FORMAT:19

[Entity]
PName=users
LName=User
Field="id","id","INT","NOT NULL",0,"",""
Field="email","email_addr","NVARCHAR(255)","NOT NULL","","",""
Field="name","display_name","NVARCHAR(100)","NULL","","",""
Index=IX_users_email=0,email
Index=UQ_users_name=1,name
DEL
)a5er";
    ERModel model = parser.parse(std::string(input));
    const auto& idxs = model.tables[0].indexes;

    ASSERT_EQ(idxs.size(), 2);
    EXPECT_EQ(idxs[0].name, "IX_users_email");
    EXPECT_FALSE(idxs[0].isUnique);
    EXPECT_EQ(idxs[0].columns[0], "email");

    EXPECT_EQ(idxs[1].name, "UQ_users_name");
    EXPECT_TRUE(idxs[1].isUnique);
}

TEST_F(ERDiagramParserTest, TextFormatCompositePK) {
    const char* input = R"a5er(# A5:ER FORMAT:19

[Entity]
PName=order_items
LName=OrderItem
Field="order_id","order_id","INT","NOT NULL",0,"",""
Field="item_id","item_id","INT","NOT NULL",1,"",""
Field="quantity","quantity","INT","NOT NULL","","",""
DEL
)a5er";
    ERModel model = parser.parse(std::string(input));
    const auto& cols = model.tables[0].columns;

    ASSERT_EQ(cols.size(), 3);
    EXPECT_TRUE(cols[0].isPrimaryKey);
    EXPECT_TRUE(cols[1].isPrimaryKey);
    EXPECT_FALSE(cols[2].isPrimaryKey);
}

TEST_F(ERDiagramParserTest, TextFormatQuotedCSVWithCommaInType) {
    const char* input = R"a5er(# A5:ER FORMAT:19

[Entity]
PName=test
LName=Test
Field="price","unit_price","DECIMAL(10,2)","NOT NULL","","",""
DEL
)a5er";
    ERModel model = parser.parse(std::string(input));

    ASSERT_EQ(model.tables[0].columns.size(), 1);
    EXPECT_EQ(model.tables[0].columns[0].type, "DECIMAL(10,2)");
}

TEST_F(ERDiagramParserTest, TextFormatEmptyEntity) {
    ERModel model = parser.parse("# A5:ER FORMAT:19\n\n[Entity]\nPName=empty\nLName=Empty\nDEL\n");

    ASSERT_EQ(model.tables.size(), 1);
    EXPECT_EQ(model.tables[0].columns.size(), 0);
}

TEST_F(ERDiagramParserTest, TextFormatNoEntities) {
    ERModel model = parser.parse("# A5:ER FORMAT:19\n");

    EXPECT_EQ(model.tables.size(), 0);
    EXPECT_EQ(model.relations.size(), 0);
    EXPECT_EQ(model.shapes.size(), 0);
}

TEST_F(ERDiagramParserTest, TextFormatUTF8BOM) {
    std::string input = "\xEF\xBB\xBF# A5:ER FORMAT:19\n\n[Entity]\nPName=bom_test\nLName=BOM\nDEL\n";
    ERModel model = parser.parse(input);

    ASSERT_EQ(model.tables.size(), 1);
    EXPECT_EQ(model.tables[0].name, "bom_test");
}

// --- DELなし / 混在 ---

TEST_F(ERDiagramParserTest, TextFormatNoDEL) {
    const char* input = R"a5er(# A5:ER FORMAT:19

[Entity]
PName=users
LName=User
Field="id","id","INT","NOT NULL",0,"",""

[Entity]
PName=orders
LName=Order
Field="id","id","INT","NOT NULL",0,"",""

[Relation]
Entity1=users
Entity2=orders
RelationType1=2
RelationType2=3
Fields1=id
Fields2=user_id
)a5er";
    ERModel model = parser.parse(std::string(input));

    EXPECT_EQ(model.tables.size(), 2);
    EXPECT_EQ(model.relations.size(), 1);
    EXPECT_EQ(model.tables[0].name, "users");
    EXPECT_EQ(model.relations[0].cardinality, "1:N");
}

TEST_F(ERDiagramParserTest, TextFormatMixedDELAndNoDEL) {
    const char* input = R"a5er(# A5:ER FORMAT:19

[Entity]
PName=table_a
LName=A
Field="id","id","INT","NOT NULL",0,"",""
DEL

[Entity]
PName=table_b
LName=B
Field="id","id","INT","NOT NULL",0,"",""

[Entity]
PName=table_c
LName=C
Field="id","id","INT","NOT NULL",0,"",""
)a5er";
    ERModel model = parser.parse(std::string(input));

    ASSERT_EQ(model.tables.size(), 3);
    EXPECT_EQ(model.tables[0].name, "table_a");
    EXPECT_EQ(model.tables[1].name, "table_b");
    EXPECT_EQ(model.tables[2].name, "table_c");
}

// ============================================================
// Color conversion edge cases
// ============================================================

TEST_F(ERDiagramParserTest, ColorDefaultTransparentIsEmpty) {
    const char* input = R"a5er(# A5:ER FORMAT:19

[Entity]
PName=nocolor
LName=NoColor
Field="id","id","INT","NOT NULL",0,"","","$FFFFFFFF"
DEL
)a5er";
    ERModel model = parser.parse(std::string(input));

    // $FFFFFFFF (8-digit, alpha=FF) → empty (A5:ER default)
    EXPECT_EQ(model.tables[0].color, "");
    EXPECT_EQ(model.tables[0].bkColor, "");
    EXPECT_EQ(model.tables[0].columns[0].color, "");
}

TEST_F(ERDiagramParserTest, ColorInvalidFormatIsEmpty) {
    const char* input = R"a5er(# A5:ER FORMAT:19

[Entity]
PName=bad
LName=Bad
Color=invalid
BkColor=#FFFFFF
Field="id","id","INT","NOT NULL",0,"","","notacolor"
DEL
)a5er";
    ERModel model = parser.parse(std::string(input));

    // Invalid formats → empty
    EXPECT_EQ(model.tables[0].color, "");
    EXPECT_EQ(model.tables[0].bkColor, "");
    EXPECT_EQ(model.tables[0].columns[0].color, "");
}

// ============================================================
// Shape edge cases
// ============================================================

TEST_F(ERDiagramParserTest, MultipleShapesPreserveExplicitColorsAndAlpha) {
    const char* input = R"a5er(# A5:ER FORMAT:19

[Shape]
ShapeType=RoundRect
Text=Group A
BrushColor=$Ff563412
BrushAlpha=128
FontColor=$FfFfFfFf
Left=50
Top=30
Width=500
Height=400
Page=MAIN
DEL

[Shape]
ShapeType=Rectangle
Text=Group B
BrushColor=$FFCCCC
FontColor=$FF332211
Left=600
Top=30
Width=300
Height=200
DEL
)a5er";
    ERModel model = parser.parse(std::string(input));

    ASSERT_EQ(model.shapes.size(), 2);
    EXPECT_EQ(model.shapes[0].shapeType, "roundrect");
    EXPECT_EQ(model.shapes[0].text, "Group A");
    EXPECT_EQ(model.shapes[0].fillColor, "#123456");
    EXPECT_EQ(model.shapes[0].fillAlpha, 128);
    EXPECT_TRUE(model.shapes[0].fontColor.empty());

    EXPECT_EQ(model.shapes[1].shapeType, "rectangle");
    EXPECT_EQ(model.shapes[1].text, "Group B");
    EXPECT_EQ(model.shapes[1].fillColor, "#CCCCFF");
    EXPECT_EQ(model.shapes[1].fontColor, "#112233");
}

TEST_F(ERDiagramParserTest, ShapeDefaultValues) {
    const char* input = R"a5er(# A5:ER FORMAT:19

[Shape]
ShapeType=Rectangle
Text=Minimal
Left=10
Top=20
Width=100
Height=50
DEL
)a5er";
    ERModel model = parser.parse(std::string(input));

    ASSERT_EQ(model.shapes.size(), 1);
    EXPECT_EQ(model.shapes[0].fillAlpha, 255);   // Default
    EXPECT_EQ(model.shapes[0].fontSize, 9);       // Default
    EXPECT_EQ(model.shapes[0].fillColor, "");     // No BrushColor → empty
    EXPECT_EQ(model.shapes[0].fontColor, "");     // No FontColor → empty
    EXPECT_EQ(model.shapes[0].page, "");
}

// ============================================================
// ERDiagramParserFactory tests
// ============================================================

class ERDiagramParserFactoryTest : public ::testing::Test {
protected:
    ERDiagramParserFactory factory;
};

TEST_F(ERDiagramParserFactoryTest, ParseByExtensionAndContent) {
    ERModel model = factory.parse(std::string(BASIC_TEXT_INPUT), "test.a5er");

    EXPECT_EQ(model.tables.size(), 2);
    EXPECT_EQ(model.tables[0].name, "users");
}

TEST_F(ERDiagramParserFactoryTest, ParseByContentFallback) {
    // No filename → canParse fallback
    ERModel model = factory.parse(std::string(BASIC_TEXT_INPUT));

    EXPECT_EQ(model.tables.size(), 2);
}

TEST_F(ERDiagramParserFactoryTest, ParseXmlByContent) {
    ERModel model = factory.parse(std::string(XML_INPUT));

    EXPECT_EQ(model.tables.size(), 1);
    EXPECT_EQ(model.tables[0].name, "products");
}

TEST_F(ERDiagramParserFactoryTest, ParseThrowsForUnknownFormat) {
    EXPECT_THROW(static_cast<void>(factory.parse("unknown format content", "test.xyz")), std::runtime_error);
}

TEST_F(ERDiagramParserFactoryTest, GenerateDDL) {
    std::string ddl = factory.generateDDL(std::string(BASIC_TEXT_INPUT), "test.a5er");

    EXPECT_NE(ddl.find("CREATE TABLE [users]"), std::string::npos);
    EXPECT_NE(ddl.find("FOREIGN KEY"), std::string::npos);
}

TEST_F(ERDiagramParserFactoryTest, GenerateDDLNoFilename) {
    std::string ddl = factory.generateDDL(std::string(BASIC_TEXT_INPUT));

    EXPECT_NE(ddl.find("CREATE TABLE"), std::string::npos);
}

TEST_F(ERDiagramParserFactoryTest, ParseWithDDL) {
    auto content = std::string(BASIC_TEXT_INPUT);
    auto [model, ddl] = factory.parseWithDDL(content, "test.a5er");

    EXPECT_EQ(model.tables.size(), 2);
    EXPECT_EQ(model.tables[0].name, "users");
    EXPECT_NE(ddl.find("CREATE TABLE [users]"), std::string::npos);
    EXPECT_NE(ddl.find("FOREIGN KEY"), std::string::npos);
}

// Mixed case alpha transparency test
TEST_F(ERDiagramParserFactoryTest, ColorMixedCaseAlphaTransparency) {
    const char* input = R"a5er(# A5:ER FORMAT:19

[Entity]
PName=test
LName=Test
Field="id","id","INT","NOT NULL",0,"","","$Ff00FF00"
DEL
)a5er";
    ERModel model = factory.parse(std::string(input));

    // $Ff... (mixed-case alpha=FF) → empty
    EXPECT_EQ(model.tables[0].columns[0].color, "");
}

// ============================================================
// Type mapping coverage (W6)
// ============================================================

TEST_F(ERDiagramParserTest, GenerateDDLAllTypeMappings) {
    ERModel model;
    ERModelTable table;
    table.name = "AllTypes";

    auto addCol = [&](const std::string& name, const std::string& type, int size = 0, int scale = 0) {
        ERModelColumn c;
        c.name = name;
        c.type = type;
        c.size = size;
        c.scale = scale;
        c.nullable = true;
        table.columns.push_back(std::move(c));
    };

    addCol("c1", "BIGINT");
    addCol("c2", "bigint");
    addCol("c3", "DATE");
    addCol("c4", "DATETIME");
    addCol("c5", "TIMESTAMP");
    addCol("c6", "BIT");
    addCol("c7", "boolean");
    addCol("c8", "TEXT");
    addCol("c9", "CLOB");
    addCol("c10", "BLOB");
    addCol("c11", "BINARY");
    addCol("c12", "NVARCHAR", 9000);   // size > 8000 → MAX
    addCol("c13", "NVARCHAR", 100);
    addCol("c14", "GEOMETRY");          // unknown → pass-through

    model.tables.push_back(std::move(table));
    std::string ddl = parser.generateDDL(model);

    EXPECT_NE(ddl.find("BIGINT"), std::string::npos);
    EXPECT_NE(ddl.find("DATE"), std::string::npos);
    EXPECT_NE(ddl.find("DATETIME2"), std::string::npos);
    EXPECT_NE(ddl.find("BIT"), std::string::npos);
    EXPECT_NE(ddl.find("NVARCHAR(MAX)"), std::string::npos);
    EXPECT_NE(ddl.find("NVARCHAR(100)"), std::string::npos);
    EXPECT_NE(ddl.find("VARBINARY(MAX)"), std::string::npos);
    EXPECT_NE(ddl.find("GEOMETRY"), std::string::npos);
}

// ============================================================
// Negative / edge case tests (S4)
// ============================================================

TEST_F(ERDiagramParserTest, CanParseEmptyString) {
    EXPECT_FALSE(parser.canParse(""));
}

TEST_F(ERDiagramParserTest, CanParseBareA5ERTag) {
    EXPECT_TRUE(parser.canParse("<A5ER Name=\"x\"></A5ER>"));
}

TEST_F(ERDiagramParserTest, ParseFileNotFound) {
    EXPECT_THROW(parser.parseFile("nonexistent_path.a5er"), std::runtime_error);
}

TEST_F(ERDiagramParserTest, XmlFormatInvalidXmlThrows) {
    EXPECT_THROW(static_cast<void>(parser.parse("<?xml version=\"1.0\"?><A5ER><broken")), std::runtime_error);
}

TEST_F(ERDiagramParserTest, XmlFormatMissingA5ERRootThrows) {
    EXPECT_THROW(static_cast<void>(parser.parse("<?xml version=\"1.0\"?><NotA5ER/>")), std::runtime_error);
}

TEST_F(ERDiagramParserTest, CardinalitySwapParentChild) {
    // type1=Many(3), type2=One(2) → parent/child should be swapped
    const char* input = R"a5er(# A5:ER FORMAT:19

[Entity]
PName=a
LName=A
Field="id","id","INT","NOT NULL",0,"",""
DEL

[Entity]
PName=b
LName=B
Field="id","id","INT","NOT NULL",0,"",""
DEL

[Relation]
Entity1=a
Entity2=b
RelationType1=3
RelationType2=2
Fields1=aid
Fields2=bid
DEL
)a5er";
    ERModel model = parser.parse(std::string(input));
    const auto& rel = model.relations[0];

    // Entity1=a was Many side → swapped: parent=b, child=a
    EXPECT_EQ(rel.parentTable, "b");
    EXPECT_EQ(rel.childTable, "a");
    EXPECT_EQ(rel.parentColumn, "bid");
    EXPECT_EQ(rel.childColumn, "aid");
    EXPECT_EQ(rel.cardinality, "1:N");
}

TEST_F(ERDiagramParserTest, ColorInvalidHexCharsIsEmpty) {
    const char* input = R"a5er(# A5:ER FORMAT:19

[Entity]
PName=test
LName=Test
Color=$ZZZZZZ
DEL
)a5er";
    ERModel model = parser.parse(std::string(input));
    EXPECT_EQ(model.tables[0].color, "");
}

}  // namespace test
}  // namespace velocitydb
