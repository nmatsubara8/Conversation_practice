local http = core.request_http_api and core.request_http_api()
local selected = {}
local pending = {}

local function register_object(id, label, color)
    core.register_node("conversation_practice:" .. id, {
        description = label,
        tiles = { "conversation_practice_blank.png^[multiply:" .. color },
        groups = { oddly_breakable_by_hand = 1 },
        on_rightclick = function(_, _, player, itemstack)
            local name = player:get_player_name()
            selected[name] = id
            core.chat_send_player(name, label .. " を選びました")
            return itemstack
        end,
    })
end

local function register_location(id, label, color)
    core.register_node("conversation_practice:" .. id, {
        description = label,
        tiles = { "conversation_practice_blank.png^[multiply:" .. color },
        groups = { oddly_breakable_by_hand = 1 },
        on_rightclick = function(pos, node, player, itemstack)
            local name = player:get_player_name()
            local object = selected[name]
            if not object or pending[name] then return itemstack end
            if not http then
                core.chat_send_player(name, "conversation_practice のHTTPアクセスを有効にしてください")
                return itemstack
            end
            local attempt = {}
            pending[name] = attempt
            http.fetch({
                url = "http://127.0.0.1:3217/practice/action",
                method = "POST",
                timeout = 3,
                extra_headers = { "Content-Type: application/json" },
                data = core.write_json({ action = "place", object = object, location = id }),
            }, function(result)
                if pending[name] ~= attempt then return end
                pending[name] = nil
                local verdict = result.succeeded and result.code == 200 and core.parse_json(result.data)
                if not verdict then
                    core.chat_send_player(name, "会話側と接続できませんでした。もう一度試せます")
                    return
                end
                if verdict.accepted then
                    local above = vector.add(pos, { x = 0, y = 1, z = 0 })
                    if core.get_node(pos).name ~= node.name or core.get_node(above).name ~= "air" then
                        core.chat_send_player(name, "置く場所の上を空けてもう一度試してください")
                        return
                    end
                    core.set_node(above, { name = "conversation_practice:water" })
                    if selected[name] == object then selected[name] = nil end
                    core.chat_send_player(name, "水を指定場所に置きました")
                else
                    local message = not verdict.objectCorrect and "対象を確かめましょう" or "場所を確かめましょう"
                    core.chat_send_player(name, message)
                end
            end)
            return itemstack
        end,
    })
end

register_object("water", "水", "#4D9DE0")
register_object("cup", "空のコップ", "#E8DFCB")
register_location("target", "指定された場所", "#50BF7A")
register_location("other", "別の場所", "#B09B80")

core.register_on_leaveplayer(function(player)
    local name = player:get_player_name()
    selected[name] = nil
    pending[name] = nil
end)
