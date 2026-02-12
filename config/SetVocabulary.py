import dashscope
from dashscope.audio.asr import *

from config import config


"""
def create_vocabulary(self, target_model: str, prefix: str, vocabulary: List[dict]) -> str:
    '''
    创建热词表
    param: target_model 热词表对应的语音识别模型版本
    param: prefix 热词表自定义前缀，仅允许数字和小写字母，小于十个字符。
    param: vocabulary 热词表字典
    return: 热词表标识符 vocabulary_id
    '''
"""

"""
def query_vocabulary(self, vocabulary_id: str) -> List[dict]:
    '''
    获取热词表内容
    param: vocabulary_id 热词表标识符
    return: 热词表
    '''

"""

"""
def update_vocabulary(self, vocabulary_id: str, vocabulary: List[dict]) -> None:
    '''
    用新的热词表替换已有热词表
    param: vocabulary_id 需要替换的热词表标识符
    param: vocabulary 热词表
    '''
"""

"""
def delete_vocabulary(self, vocabulary_id: str) -> None:
    '''
    删除热词表
    param: vocabulary_id 需要删除的热词表标识符
    '''
"""

# 定制热词，请参照：https://help.aliyun.com/zh/model-studio/developer-reference/custom-hot-words?spm=a2c4g.11186623.0.0.736a4303JmYZ8a
dashscope.api_key = config["DASHSCOPE_API_KEY"]

service = VocabularyService()

my_vocabulary = vocabulary = [
    # ========== 大数据技术栈 ==========
    {"text": "Hadoop", "weight": 4, "lang": "en"},
    {"text": "Spark", "weight": 4, "lang": "en"},
    {"text": "Flink", "weight": 4, "lang": "en"},
    {"text": "Kafka", "weight": 4, "lang": "en"},
    {"text": "Hive", "weight": 4, "lang": "en"},
    {"text": "HBase", "weight": 4, "lang": "en"},
    {"text": "Zookeeper", "weight": 4, "lang": "en"},
    {"text": "Airflow", "weight": 4, "lang": "en"},
    {"text": "Iceberg", "weight": 4, "lang": "en"},

    # ========== 数据库系统 ==========
    {"text": "MySQL", "weight": 4, "lang": "en"},
    {"text": "PostgreSQL", "weight": 4, "lang": "en"},
    {"text": "Redis", "weight": 4, "lang": "en"},
    {"text": "MongoDB", "weight": 4, "lang": "en"},
    {"text": "ClickHouse", "weight": 4, "lang": "en"},
    {"text": "Cassandra", "weight": 4, "lang": "en"},
    {"text": "时序数据库", "weight": 4, "lang": "zh"},
    {"text": "图数据库", "weight": 4, "lang": "zh"},

    # ========== 数据分析工具 ==========
    {"text": "Pandas", "weight": 4, "lang": "en"},
    {"text": "Tableau", "weight": 4, "lang": "en"},
    {"text": "Power BI", "weight": 4, "lang": "en"},
    {"text": "Superset", "weight": 4, "lang": "en"},
    {"text": "数据可视化", "weight": 4, "lang": "zh"},
    {"text": "AB测试", "weight": 4, "lang": "zh"},
    {"text": "漏斗分析", "weight": 4, "lang": "zh"},

    # ========== 机器学习算法 ==========
    {"text": "XGBoost", "weight": 4, "lang": "en"},
    {"text": "LightGBM", "weight": 4, "lang": "en"},
    {"text": "Transformer", "weight": 4, "lang": "en"},
    {"text": "GAN", "weight": 4, "lang": "en"},
    {"text": "强化学习", "weight": 4, "lang": "zh"},
    {"text": "梯度消失", "weight": 4, "lang": "zh"},
    {"text": "过拟合", "weight": 4, "lang": "zh"},

    # ========== 深度学习框架 ==========
    {"text": "TensorFlow", "weight": 4, "lang": "en"},
    {"text": "PyTorch", "weight": 4, "lang": "en"},
    {"text": "Keras", "weight": 4, "lang": "en"},
    {"text": "ONNX", "weight": 4, "lang": "en"},
    {"text": "模型蒸馏", "weight": 4, "lang": "zh"},

    # ========== NLP技术栈 ==========
    {"text": "BERT", "weight": 4, "lang": "en"},
    {"text": "GPT", "weight": 4, "lang": "en"},
    {"text": "Word2Vec", "weight": 4, "lang": "en"},
    {"text": "TF-IDF", "weight": 4, "lang": "en"},
    {"text": "命名实体识别", "weight": 4, "lang": "zh"},
    {"text": "文本摘要", "weight": 4, "lang": "zh"},

    # ========== 计算机视觉 ==========
    {"text": "YOLO", "weight": 4, "lang": "en"},
    {"text": "ResNet", "weight": 4, "lang": "en"},
    {"text": "OpenCV", "weight": 4, "lang": "en"},
    {"text": "目标检测", "weight": 4, "lang": "zh"},
    {"text": "图像分割", "weight": 4, "lang": "zh"},
    {"text": "数据增强", "weight": 4, "lang": "zh"},

    # ========== 数据工程 ==========
    {"text": "ETL", "weight": 4, "lang": "en"},
    {"text": "CDC", "weight": 4, "lang": "en"},
    {"text": "数据湖", "weight": 4, "lang": "zh"},
    {"text": "数据治理", "weight": 4, "lang": "zh"},
    {"text": "元数据", "weight": 4, "lang": "zh"},
    {"text": "血缘分析", "weight": 4, "lang": "zh"},

    # ========== 云原生技术 ==========
    {"text": "Docker", "weight": 4, "lang": "en"},
    {"text": "Kubernetes", "weight": 4, "lang": "en"},
    {"text": "Serverless", "weight": 4, "lang": "en"},
    {"text": "微服务", "weight": 4, "lang": "zh"},
    {"text": "服务网格", "weight": 4, "lang": "zh"},

    # ========== 核心方法论 ==========
    {"text": "CRISP-DM", "weight": 4, "lang": "en"},
    {"text": "特征工程", "weight": 4, "lang": "zh"},
    {"text": "交叉验证", "weight": 4, "lang": "zh"},
    {"text": "混淆矩阵", "weight": 4, "lang": "zh"},
    {"text": "召回率", "weight": 4, "lang": "zh"},
]

prefix = "prefix"
target_model = "paraformer-realtime-v2"

"""创建热词表"""
vocabulary_id = service.create_vocabulary(prefix=prefix, target_model=target_model, vocabulary=my_vocabulary)

print("所有热词表：", service.list_vocabularies())

"""更新热词表"""
# service.update_vocabulary(vocabulary_id=vocabulary_id, vocabulary=my_vocabulary)
# print("查询目标热词表：", service.query_vocabulary(vocabulary_id))

