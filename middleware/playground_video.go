package middleware

import (
	"github.com/gin-gonic/gin"
)

// PlaygroundVideoConvert 将视频操练场（0帧起手）的请求路径重写为标准视频提交路径，
// 使 Distribute 按 /v1/video/generations 的既有逻辑解析模型、分组并选择渠道。
func PlaygroundVideoConvert() func(c *gin.Context) {
	return func(c *gin.Context) {
		c.Request.URL.Path = "/v1/video/generations"
		c.Next()
	}
}
