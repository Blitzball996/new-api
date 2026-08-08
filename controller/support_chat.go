package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type supportSendRequest struct {
	Content string `json:"content"`
	// 客服端指定目标会话；用户端忽略该字段，只能发自己的会话
	ConversationId int `json:"conversation_id"`
}

// GetSupportConversation 用户端：取自己的会话与消息
func GetSupportConversation(c *gin.Context) {
	userId := c.GetInt("id")
	username := c.GetString("username")

	conv, err := model.GetOrCreateConversation(userId, username)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}

	afterId, _ := strconv.Atoi(c.Query("after_id"))
	messages, err := model.GetSupportMessages(conv.Id, afterId, 100)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}

	// 用户看过了就清用户侧未读
	if afterId == 0 || len(messages) > 0 {
		_ = model.MarkSupportRead(conv.Id, model.SupportRoleUser)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"conversation": conv,
			"messages":     messages,
		},
	})
}

// SendSupportMessage 用户端：发消息
func SendSupportMessage(c *gin.Context) {
	userId := c.GetInt("id")
	username := c.GetString("username")

	var req supportSendRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "请求参数错误")
		return
	}
	content := strings.TrimSpace(req.Content)
	if content == "" {
		common.ApiErrorMsg(c, "消息内容不能为空")
		return
	}

	conv, err := model.GetOrCreateConversation(userId, username)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}

	msg, err := model.AddSupportMessage(conv, model.SupportRoleUser, userId, username, content)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    msg,
	})
}

// GetSupportUnread 用户端：未读角标
func GetSupportUnread(c *gin.Context) {
	userId := c.GetInt("id")
	conv, err := model.GetOrCreateConversation(userId, c.GetString("username"))
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    gin.H{"unread": conv.UnreadUser},
	})
}

// ListSupportConversationsAdmin 客服端：会话列表
func ListSupportConversationsAdmin(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("p", "1"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}
	status := c.Query("status")
	keyword := strings.TrimSpace(c.Query("keyword"))

	list, total, err := model.ListSupportConversations(status, keyword, (page-1)*pageSize, pageSize)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"items":     list,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
		},
	})
}

// GetSupportConversationAdmin 客服端：读某个会话的消息
func GetSupportConversationAdmin(c *gin.Context) {
	convId, err := strconv.Atoi(c.Param("id"))
	if err != nil || convId <= 0 {
		common.ApiErrorMsg(c, "无效的会话 ID")
		return
	}
	conv, err := model.GetSupportConversationById(convId)
	if err != nil {
		common.ApiErrorMsg(c, "会话不存在")
		return
	}

	afterId, _ := strconv.Atoi(c.Query("after_id"))
	messages, err := model.GetSupportMessages(conv.Id, afterId, 100)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if afterId == 0 || len(messages) > 0 {
		_ = model.MarkSupportRead(conv.Id, model.SupportRoleAdmin)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"conversation": conv,
			"messages":     messages,
		},
	})
}

// SendSupportMessageAdmin 客服端：回消息
func SendSupportMessageAdmin(c *gin.Context) {
	adminId := c.GetInt("id")
	adminName := c.GetString("username")

	var req supportSendRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "请求参数错误")
		return
	}
	content := strings.TrimSpace(req.Content)
	if content == "" {
		common.ApiErrorMsg(c, "消息内容不能为空")
		return
	}

	convId := req.ConversationId
	if convId == 0 {
		convId, _ = strconv.Atoi(c.Param("id"))
	}
	conv, err := model.GetSupportConversationById(convId)
	if err != nil {
		common.ApiErrorMsg(c, "会话不存在")
		return
	}

	msg, err := model.AddSupportMessage(conv, model.SupportRoleAdmin, adminId, adminName, content)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    msg,
	})
}

// SetSupportConversationStatusAdmin 客服端：开关会话
func SetSupportConversationStatusAdmin(c *gin.Context) {
	convId, err := strconv.Atoi(c.Param("id"))
	if err != nil || convId <= 0 {
		common.ApiErrorMsg(c, "无效的会话 ID")
		return
	}
	var body struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		common.ApiErrorMsg(c, "请求参数错误")
		return
	}
	if err := model.SetSupportConversationStatus(convId, body.Status); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GetSupportUnreadAdmin 客服端角标：待回复会话数
func GetSupportUnreadAdmin(c *gin.Context) {
	count, err := model.CountSupportAdminUnread()
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    gin.H{"pending": count},
	})
}
