package api

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Office files are ZIP containers. Only selected XML parts are read, with
// independent limits on both compressed input and expanded XML.
func officeParts(data []byte, accept func(string) bool) (map[string][]byte, error) {
	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, errors.New("Office 文件已损坏")
	}
	parts := make(map[string][]byte)
	var total uint64
	for _, file := range reader.File {
		if !accept(file.Name) {
			continue
		}
		if len(parts) >= 100 || file.UncompressedSize64 > 10<<20 || total+file.UncompressedSize64 > 30<<20 {
			return nil, errors.New("压缩文件展开后过大")
		}
		total += file.UncompressedSize64
		stream, err := file.Open()
		if err != nil {
			return nil, errors.New("Office 文件已损坏")
		}
		body, readErr := io.ReadAll(io.LimitReader(stream, 10<<20+1))
		_ = stream.Close()
		if readErr != nil || len(body) > 10<<20 {
			return nil, errors.New("Office 文件内容过大")
		}
		parts[file.Name] = body
	}
	return parts, nil
}

func xmlText(data []byte) string {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	var out strings.Builder
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		switch item := token.(type) {
		case xml.CharData:
			out.Write(item)
		case xml.EndElement:
			switch item.Name.Local {
			case "p", "row", "tr", "li":
				out.WriteByte('\n')
			case "c", "tc", "td":
				out.WriteByte('\t')
			}
		case xml.StartElement:
			switch item.Name.Local {
			case "tab":
				out.WriteByte('\t')
			case "br":
				out.WriteByte('\n')
			}
		}
	}
	return strings.TrimSpace(out.String())
}

func extractDocx(data []byte) (string, int, error) {
	parts, err := officeParts(data, func(name string) bool { return name == "word/document.xml" })
	if err != nil {
		return "", 0, err
	}
	body := parts["word/document.xml"]
	if len(body) == 0 {
		return "", 0, errors.New("Word 文件结构不完整")
	}
	text := xmlText(body)
	if text == "" {
		return "", 0, errors.New("Word 文件中没有可提取的正文")
	}
	return text, 0, nil
}

func sharedStrings(data []byte) []string {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	values := []string{}
	var value strings.Builder
	inside := false
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		switch item := token.(type) {
		case xml.StartElement:
			if item.Name.Local == "si" {
				inside = true
				value.Reset()
			}
		case xml.CharData:
			if inside {
				value.Write(item)
			}
		case xml.EndElement:
			if item.Name.Local == "si" {
				values = append(values, value.String())
				inside = false
			}
		}
	}
	return values
}

func columnIndex(reference string) int {
	index := 0
	for _, letter := range reference {
		if letter < 'A' || letter > 'Z' {
			break
		}
		index = index*26 + int(letter-'A'+1)
	}
	if index == 0 {
		return 0
	}
	return index - 1
}

func sheetText(data []byte, shared []string) string {
	decoder := xml.NewDecoder(bytes.NewReader(data))
	var result strings.Builder
	var row []string
	var cell strings.Builder
	cellIndex := 0
	cellType := ""
	inCell := false
	inValue := false
	rowCount := 0
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		switch item := token.(type) {
		case xml.StartElement:
			switch item.Name.Local {
			case "row":
				row = make([]string, 0, 10)
			case "c":
				inCell = true
				cell.Reset()
				cellType = ""
				cellIndex = len(row)
				for _, attr := range item.Attr {
					switch attr.Name.Local {
					case "r":
						cellIndex = columnIndex(strings.ToUpper(attr.Value))
					case "t":
						cellType = attr.Value
					}
				}
			case "v", "t":
				if inCell {
					inValue = true
				}
			}
		case xml.CharData:
			if inCell && inValue {
				cell.Write(item)
			}
		case xml.EndElement:
			switch item.Name.Local {
			case "v", "t":
				inValue = false
			case "c":
				value := cell.String()
				if cellType == "s" {
					index, err := strconv.Atoi(value)
					if err == nil && index >= 0 && index < len(shared) {
						value = shared[index]
					}
				}
				if cellIndex < 100 {
					for len(row) <= cellIndex {
						row = append(row, "")
					}
					row[cellIndex] = value
				}
				inCell = false
			case "row":
				if rowCount < 5000 {
					line := strings.TrimSpace(strings.Join(row, "\t"))
					if line != "" {
						result.WriteString(line)
						result.WriteByte('\n')
					}
				}
				rowCount++
			}
		}
	}
	return strings.TrimSpace(result.String())
}

func extractXlsx(data []byte) (string, int, error) {
	parts, err := officeParts(data, func(name string) bool {
		return name == "xl/sharedStrings.xml" || strings.HasPrefix(name, "xl/worksheets/sheet") && strings.HasSuffix(name, ".xml")
	})
	if err != nil {
		return "", 0, err
	}
	shared := sharedStrings(parts["xl/sharedStrings.xml"])
	names := []string{}
	for name := range parts {
		if strings.HasPrefix(name, "xl/worksheets/sheet") {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	if len(names) == 0 {
		return "", 0, errors.New("Excel 文件中没有工作表")
	}
	var result strings.Builder
	for i, name := range names {
		if i >= 30 {
			break
		}
		body := sheetText(parts[name], shared)
		if body != "" {
			fmt.Fprintf(&result, "工作表 %d\n%s\n\n", i+1, body)
		}
	}
	if result.Len() == 0 {
		return "", 0, errors.New("Excel 文件中没有可提取的内容")
	}
	return result.String(), min(len(names), 30), nil
}

func extractDocument(ctx context.Context, filename string, data []byte) (string, int, error) {
	if len(data) == 0 {
		return "", 0, errors.New("文件内容为空")
	}
	ext := strings.ToLower(filepath.Ext(filename))
	var value string
	var pages int
	var err error
	switch ext {
	case ".docx":
		value, pages, err = extractDocx(data)
	case ".xlsx":
		value, pages, err = extractXlsx(data)
	case ".pdf":
		if !bytes.HasPrefix(data, []byte("%PDF-")) {
			return "", 0, errors.New("PDF 文件内容无效")
		}
		parseCtx, cancel := context.WithTimeout(ctx, 18*time.Second)
		defer cancel()
		command := exec.CommandContext(parseCtx, "pdftotext", "-layout", "-", "-")
		command.Stdin = bytes.NewReader(data)
		output, parseErr := command.Output()
		if parseErr != nil {
			return "", 0, errors.New("PDF 文字提取失败；请上传可搜索文字版 PDF")
		}
		value = string(output)
	case ".txt", ".md", ".markdown", ".json", ".csv", ".html", ".htm", ".xml":
		if ext == ".csv" {
			reader := csv.NewReader(bytes.NewReader(data))
			reader.FieldsPerRecord = -1
			var out strings.Builder
			for {
				record, readErr := reader.Read()
				if readErr != nil {
					break
				}
				out.WriteString(strings.Join(record, "\t"))
				out.WriteByte('\n')
			}
			value = out.String()
		} else if ext == ".html" || ext == ".htm" || ext == ".xml" {
			value = xmlText(data)
		} else {
			value = string(data)
		}
	default:
		return "", 0, errors.New("暂不支持该文件类型；请上传 PDF、DOCX、XLSX、CSV 或文本文件")
	}
	if err != nil {
		return "", 0, err
	}
	value = cleanText(value, 60000)
	if value == "" {
		return "", 0, errors.New("文件中没有可提取的正文")
	}
	return value, pages, nil
}
