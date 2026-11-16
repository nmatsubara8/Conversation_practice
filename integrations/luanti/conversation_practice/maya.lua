local http = ...
local prefix = "conversation_practice:"
local histories = {}

local function request(player, data, callback)
    if not http then
        core.chat_send_player(player, "会話連携のHTTP設定を確認してください")
        callback(nil)
        return
    end
    data.player = player
    http.fetch({
        url = "http://127.0.0.1:3217/practice/companion",
        method = "POST",
        timeout = 8,
        extra_headers = { "Content-Type: application/json" },
        data = core.write_json(data),
    }, function(response)
        if not core.get_player_by_name(player) then return end
        local payload = response.succeeded and response.code == 200 and core.parse_json(response.data)
        if payload then callback(payload)
        else
            core.chat_send_player(player, "発話・履歴サービスに接続できませんでした")
            callback(nil)
        end
    end)
end

local function face(object, destination)
    local pos = object:get_pos()
    if pos then object:set_yaw(core.dir_to_yaw(vector.direction(pos, destination))) end
end

local function cue(player, pos)
    core.add_particle({
        pos = vector.add(pos, { x = 0, y = 1, z = 0 }),
        velocity = { x = 0, y = 0.5, z = 0 },
        expirationtime = 1.5, size = 8, glow = 8, playername = player,
        texture = "conversation_practice_blank.png^[multiply:#75ECFF",
    })
end

core.register_entity(prefix .. "maya", {
    initial_properties = {
        physical = true,
        collide_with_objects = false,
        collisionbox = { -0.3, -0.5, -0.3, 0.3, 0.5, 0.3 },
        visual = "cube",
        textures = { "conversation_practice_blank.png^[multiply:#45A694",
            "conversation_practice_blank.png", "conversation_practice_blank.png",
            "conversation_practice_blank.png", "conversation_practice_blank.png",
            "conversation_practice_blank.png" },
        static_save = false,
        nametag = "Maya",
    },

    on_rightclick = function(self, clicker)
        local name = clicker:get_player_name()
        if name ~= self.owner then return end
        if self.phase == "invite" then
            local origin = self.object:get_pos()
            local water = core.find_node_near(origin, 12, { prefix .. "water" })
            local destination = core.find_node_near(origin, 12, { prefix .. "target" })
            if not water or not destination or water.y ~= destination.y then
                core.chat_send_player(name, "水と緑の台を、近くの同じ高さに置いてください")
                return
            end
            self.water = water
            self.destination = destination
            self.phase = "pickup"
            face(self.object, water)
            cue(name, water)
            core.chat_send_player(name, "マヤが水の方へ歩き出しました")
        elseif self.phase == "confirm" then
            local above = vector.add(self.destination, { x = 0, y = 1, z = 0 })
            if core.get_node(self.destination).name ~= prefix .. "target"
                or core.get_node(above).name ~= "air" or core.is_protected(above, name) then
                core.chat_send_player(name, "指定の台に水を置けません")
                return
            end
            core.set_node(above, { name = prefix .. "water" })
            self.phase = "done"
            self.object:set_nametag_attributes({ text = "Maya" })
            core.chat_send_player(name, "マヤが台に水を置きました")
        end
    end,

    on_step = function(self, elapsed)
        if self.phase ~= "pickup" and self.phase ~= "travel" then return end
        if not core.get_player_by_name(self.owner) then self.object:remove(); return end
        local target = self.phase == "pickup" and self.water or self.destination
        local pos = self.object:get_pos()
        if not pos then return end
        local approach = { x = target.x, y = pos.y, z = target.z }
        if vector.distance(pos, approach) > 1.25 then
            local direction = vector.direction(pos, approach)
            local next_pos = vector.add(pos, vector.multiply(direction, math.min(elapsed * 1.35, 0.3)))
            local node = core.get_node(vector.round(next_pos))
            local definition = core.registered_nodes[node.name]
            if definition and not definition.walkable then
                face(self.object, approach)
                self.object:move_to(next_pos, true)
            end
            return
        end
        if self.phase == "pickup" then
            self.phase = "travel"
            self.object:set_nametag_attributes({ text = "Maya  💧" })
            self.waiting_for_line = true
            request(self.owner, { action = "talk", phase = "travel" }, function(result)
                self.waiting_for_line = false
                if result and self.object:get_pos() and self.phase == "travel" then
                    core.chat_send_player(self.owner, "Maya: " .. result.text)
                end
            end)
        elseif not self.waiting_for_line then
            self.phase = "confirm"
            face(self.object, self.destination)
            cue(self.owner, self.destination)
            core.chat_send_player(self.owner, "マヤが緑の台を示しています。置いてよければマヤを右クリック")
        end
    end,
})

local companions = {}
core.register_chatcommand("practice_maya", {
    description = "練習用のマヤを呼ぶ",
    privs = { server = true },
    func = function(name)
        local player = core.get_player_by_name(name)
        if not player then return false end
        if companions[name] and companions[name]:get_pos() then companions[name]:remove() end
        local pos = vector.add(player:get_pos(), { x = 0, y = 0.6, z = 0 })
        local object = core.add_entity(pos, prefix .. "maya")
        if not object then return false, "マヤを呼べませんでした" end
        companions[name] = object
        local maya = object:get_luaentity()
        maya.owner = name
        maya.phase = "invite"
        local water = core.find_node_near(pos, 12, { prefix .. "water" })
        if water then face(object, water); cue(name, water) end
        return true, "マヤが待っています。一緒に水を運ぶなら右クリック"
    end,
})

core.register_chatcommand("practice_history", {
    description = "マヤの発話履歴を開く",
    func = function(name)
        request(name, { action = "history" }, function(result)
            if not result then return end
            histories[name] = result.entries
            local labels = {}
            for index, entry in ipairs(result.entries) do
                labels[index] = core.formspec_escape(entry.text)
            end
            core.show_formspec(name, prefix .. "history",
                "formspec_version[4]size[13,8]label[0.5,0.5;マヤの発話を選んで意味を確認]" ..
                "textlist[0.5,1;12,5.5;lines;" .. table.concat(labels, ",") .. "]" ..
                "button[0.5,6.8;3,0.7;meaning;意味を確認]")
        end)
        return true
    end,
})

local selected = {}
core.register_on_player_receive_fields(function(player, form, fields)
    if form ~= prefix .. "history" then return end
    local name = player:get_player_name()
    if fields.lines then selected[name] = core.explode_textlist_event(fields.lines).index end
    local index = selected[name] or 1
    local entry = histories[name] and histories[name][index]
    if fields.meaning and entry then
        request(name, { action = "meaning", id = entry.id }, function(result)
            if not result then return end
            core.show_formspec(name, prefix .. "meaning", "formspec_version[4]size[13,8]" ..
                "textarea[0.5,0.5;12,7;meaning;;" .. core.formspec_escape(entry.text .. "\n\n" .. result.meaning) .. "]")
        end)
    end
    return true
end)

core.register_on_leaveplayer(function(player)
    local name = player:get_player_name()
    if companions[name] then companions[name]:remove() end
    companions[name], histories[name], selected[name] = nil, nil, nil
end)
