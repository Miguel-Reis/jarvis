-- PalKeeperMod — mod C++ para UE4SS (Palworld dedicated server)
--
-- Compila em Windows com MSVC, dentro da árvore de mods C++ do RE-UE4SS:
--   1. git clone --recursive https://github.com/UE4SS-RE/RE-UE4SS
--      (ou o fork experimental-palworld/RE-UE4SS com suporte Palworld)
--   2. copiar esta pasta para RE-UE4SS/cppmods/PalKeeperMod
--   3. adicionar `includes("cppmods/PalKeeperMod")` ao xmake.lua raiz do RE-UE4SS
--   4. xmake f -m "Game__Shipping__Win64" && xmake build PalKeeperMod
--
-- O output PalKeeperMod.dll instala-se em:
--   <servidor>/Pal/Binaries/Win64/ue4ss/Mods/PalKeeperMod/dlls/main.dll

local projectName = "PalKeeperMod"

add_requires("nlohmann_json")

target(projectName)
    add_rules("ue4ss.mod")
    add_includedirs("src")
    add_files("src/**.cpp")
    add_packages("nlohmann_json")
    add_syslinks("winhttp")
    set_languages("cxx20")
